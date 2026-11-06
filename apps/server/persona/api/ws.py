"""Chat WebSocket: /api/v1/ws/chat?token=<ws-token>

Client -> server:
  {"type": "send", "chat_id", "content"}
  {"type": "regenerate", "chat_id", "message_id"}
  {"type": "next", "chat_id", "character_id"?}      rooms only
  {"type": "stop"}                                    cancel current generation
  {"type": "ping"}
Server -> client: user_message | typing | start | delta | done | error | stopped | pong
"""

from __future__ import annotations

import asyncio
import contextlib
import logging

import jwt
from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from persona.api.chats import TurnError, run_turn
from persona.core.config import get_settings
from persona.core.ratelimit import get_limiter
from persona.core.security import decode_token
from persona.db import sessionmaker
from persona.models import Chat, User

router = APIRouter(tags=["ws"])
log = logging.getLogger("persona.ws")


async def ws_user(ws: WebSocket) -> User | None:
    token = ws.query_params.get("token", "")
    try:
        payload = decode_token(token, "ws")
    except jwt.PyJWTError:
        return None
    async with sessionmaker()() as db:
        user = await db.get(User, payload["sub"])
        return user if user and user.is_active else None


async def check_origin(ws: WebSocket) -> bool:
    origin = ws.headers.get("origin")
    if not origin:  # native mobile clients send no Origin
        return True
    s = get_settings()
    allowed = {o.rstrip("/") for o in s.cors_origins} | {s.public_url.rstrip("/")}
    host = ws.headers.get("host", "")
    return origin.rstrip("/") in allowed or origin.split("://", 1)[-1] == host


@router.websocket("/ws/chat")
async def chat_ws(ws: WebSocket) -> None:
    if not await check_origin(ws):
        await ws.close(code=4403)
        return
    user = await ws_user(ws)
    if user is None:
        await ws.close(code=4401)
        return
    await ws.accept()
    current: asyncio.Task | None = None

    async def run(kind: str, data: dict) -> None:
        try:
            async with sessionmaker()() as db:
                u = await db.get(User, user.id)
                chat = await db.get(Chat, str(data.get("chat_id", "")))
                if chat is None or chat.user_id != user.id or u is None:
                    await ws.send_json({"type": "error", "status": 404, "detail": "Chat not found"})
                    return
                kwargs: dict = {}
                if kind == "send":
                    content = str(data.get("content", "")).strip()
                    if not content or len(content) > 8000:
                        await ws.send_json(
                            {
                                "type": "error",
                                "status": 422,
                                "detail": "Message must be 1-8000 characters",
                            }
                        )
                        return
                    kwargs["content"] = content
                elif kind == "regenerate":
                    kwargs["regenerate_id"] = str(data.get("message_id", ""))
                elif kind == "next":
                    kwargs["speaker_id"] = data.get("character_id")
                async for ev in run_turn(db, chat, u, **kwargs):
                    await ws.send_json(ev)
        except TurnError as e:
            await ws.send_json({"type": "error", "status": e.status_code, "detail": e.detail})
        except asyncio.CancelledError:
            with contextlib.suppress(Exception):
                await ws.send_json({"type": "stopped"})
            raise
        except WebSocketDisconnect:
            pass
        except Exception:  # noqa: BLE001
            log.exception("chat ws turn failed")
            with contextlib.suppress(Exception):
                await ws.send_json({"type": "error", "status": 500, "detail": "Internal error"})

    try:
        while True:
            data = await ws.receive_json()
            kind = data.get("type")
            if kind == "ping":
                await ws.send_json({"type": "pong"})
            elif kind == "stop":
                if current and not current.done():
                    current.cancel()
            elif kind in ("send", "regenerate", "next"):
                if current and not current.done():
                    # A turn that just sent "done" may still be wrapping up.
                    with contextlib.suppress(TimeoutError, asyncio.CancelledError, Exception):
                        await asyncio.wait_for(asyncio.shield(current), timeout=1.5)
                if current and not current.done():
                    await ws.send_json(
                        {
                            "type": "error",
                            "status": 409,
                            "detail": "Already generating; stop it first",
                        }
                    )
                    continue
                ok, _ = await get_limiter().hit(
                    f"chat:u:{user.id}", get_settings().rl_chat_per_min, 60
                )
                if not ok:
                    await ws.send_json({"type": "error", "status": 429, "detail": "Slow down"})
                    continue
                current = asyncio.create_task(run(kind, data))
            else:
                await ws.send_json({"type": "error", "status": 400, "detail": "Unknown type"})
    except (WebSocketDisconnect, RuntimeError):
        pass
    finally:
        if current and not current.done():
            current.cancel()
            with contextlib.suppress(asyncio.CancelledError, Exception):
                await current
