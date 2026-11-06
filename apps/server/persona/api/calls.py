"""Voice calls (/ws/call) and one-shot transcription for the composer mic (/stt)."""

from __future__ import annotations

import asyncio
import contextlib
import json
import logging

from fastapi import APIRouter, File, HTTPException, UploadFile, WebSocket, WebSocketDisconnect

from persona.api.ws import check_origin, ws_user
from persona.core.config import get_settings
from persona.core.deps import DB, CurrentUser, gen_limit
from persona.db import sessionmaker
from persona.models import Character, Chat, User
from persona.services import audio, settings_store, storage
from persona.services.call import CallSession
from persona.services.http import ProviderError
from persona.services.stt import registry as stt

router = APIRouter(tags=["calls"])
log = logging.getLogger("persona.calls")
MAX_CALL_SECONDS = 60 * 60


@router.post("/stt", dependencies=[gen_limit])
async def transcribe_upload(db: DB, _: CurrentUser, file: UploadFile = File(...)) -> dict:
    data = await storage.read_limited(file, get_settings().max_audio_mb * 1024 * 1024)
    if storage.sniff_audio(data) is None:
        raise HTTPException(415, "Unsupported audio format")
    cfg = await settings_store.load(db)
    try:
        pcm = await audio.decode_to_pcm16(data, 16000)
        text = await stt.transcribe(cfg, pcm)
    except (ProviderError, RuntimeError) as e:
        raise HTTPException(502, str(e)) from e
    return {"text": text}


@router.websocket("/ws/call")
async def call_ws(ws: WebSocket) -> None:
    """Binary frames in: PCM16 mono 16 kHz. Binary frames out: PCM16 mono 24 kHz.
    Text frames carry JSON control/events (see services/call.py)."""
    if not await check_origin(ws):
        await ws.close(code=4403)
        return
    user = await ws_user(ws)
    if user is None:
        await ws.close(code=4401)
        return
    chat_id = ws.query_params.get("chat_id", "")
    await ws.accept()
    send_lock = asyncio.Lock()

    async def send_json(m: dict) -> None:
        async with send_lock:
            await ws.send_text(json.dumps(m))

    async def send_bytes(b: bytes) -> None:
        async with send_lock:
            await ws.send_bytes(b)

    async with sessionmaker()() as db:
        chat = await db.get(Chat, chat_id)
        u = await db.get(User, user.id)
        if chat is None or chat.user_id != user.id or u is None:
            await send_json({"type": "error", "detail": "Chat not found", "fatal": True})
            await ws.close(code=4404)
            return
        if chat.room_id or not chat.character_id:
            await send_json(
                {
                    "type": "error",
                    "detail": "Calls work with one character at a time",
                    "fatal": True,
                }
            )
            await ws.close(code=4400)
            return
        character = await db.get(Character, chat.character_id)
        session = CallSession(db, chat, u, character, send_json, send_bytes)
        try:
            await session.start()
        except ProviderError as e:
            await send_json({"type": "error", "detail": str(e), "fatal": True})
            await ws.close(code=4409)
            return

        loop = asyncio.get_running_loop()
        deadline = loop.time() + MAX_CALL_SECONDS
        try:
            while loop.time() < deadline:
                msg = await ws.receive()
                if msg["type"] == "websocket.disconnect":
                    break
                if msg.get("bytes") is not None:
                    await session.on_audio(msg["bytes"])
                elif msg.get("text"):
                    try:
                        ctrl = json.loads(msg["text"])
                    except json.JSONDecodeError:
                        continue
                    if ctrl.get("type") == "hangup":
                        break
                    await session.on_control(ctrl)
        except (WebSocketDisconnect, RuntimeError):
            pass
        finally:
            await session.close()
            with contextlib.suppress(Exception):
                await ws.close()
