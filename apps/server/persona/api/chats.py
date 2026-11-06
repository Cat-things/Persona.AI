from __future__ import annotations

import json
from collections.abc import AsyncIterator
from typing import Any

from fastapi import APIRouter, HTTPException, Query, status
from fastapi.responses import StreamingResponse
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from persona.api.characters import get_visible, to_out
from persona.core.deps import DB, CurrentUser, chat_limit
from persona.models import (
    Character,
    Chat,
    Memory,
    Message,
    MessageCandidate,
    Persona,
    Room,
    User,
)
from persona.schemas import (
    CharacterCard,
    ChatCreate,
    ChatDetail,
    ChatListItem,
    ChatOut,
    ChatUpdate,
    EditMessageIn,
    MemoryIn,
    MemoryOut,
    MessageOut,
    RateIn,
    RoomOut,
    SelectCandidateIn,
    SendMessageIn,
)
from persona.services import chat_engine, content_filter, settings_store

router = APIRouter(tags=["chats"])


# ---------- helpers ----------
async def owned_chat(db: AsyncSession, chat_id: str, user: User) -> Chat:
    chat = await db.get(Chat, chat_id)
    if chat is None or chat.user_id != user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Chat not found")
    return chat


async def owned_message(db: AsyncSession, message_id: str, user: User) -> tuple[Message, Chat]:
    msg = await db.get(Message, message_id)
    if msg is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Message not found")
    chat = await owned_chat(db, msg.chat_id, user)
    return msg, chat


async def last_message(db: AsyncSession, chat: Chat) -> Message | None:
    return await db.scalar(
        select(Message).where(Message.chat_id == chat.id).order_by(Message.position.desc()).limit(1)
    )


class TurnError(Exception):
    def __init__(self, status_code: int, detail: str) -> None:
        self.status_code, self.detail = status_code, detail


async def run_turn(
    db: AsyncSession,
    chat: Chat,
    user: User,
    *,
    content: str | None = None,
    regenerate_id: str | None = None,
    speaker_id: str | None = None,
) -> AsyncIterator[dict[str, Any]]:
    """One conversational turn. Shared by the SSE endpoints and the WebSocket."""
    room = await db.get(Room, chat.room_id) if chat.room_id else None
    regenerate: Message | None = None
    speakers: list[Character] = []

    if regenerate_id:
        regenerate = await db.get(Message, regenerate_id)
        last = await last_message(db, chat)
        if regenerate is None or regenerate.chat_id != chat.id:
            raise TurnError(404, "Message not found")
        if regenerate.role != "assistant" or last is None or last.id != regenerate.id:
            raise TurnError(400, "Only the latest reply can be regenerated")
        c = await db.get(Character, regenerate.character_id) if regenerate.character_id else None
        if c is None:
            raise TurnError(400, "That character no longer exists")
        speakers = [c]
    else:
        if content is not None:
            cfg = await settings_store.load(db)
            if content_filter.check(content, {**cfg, "content_filter": False}).blocked:
                raise TurnError(422, "That message isn't allowed on this instance.")
            umsg = await chat_engine.add_message(db, chat, "user", content.strip())
            yield {"type": "user_message", "message": chat_engine.message_out(umsg)}
        if room:
            if speaker_id:
                speakers = [m.character for m in room.members if m.character_id == speaker_id]
            else:
                speakers = await chat_engine.pick_speakers(
                    db, chat, room, content, max_turns=3 if content else 1
                )
        else:
            c = await db.get(Character, chat.character_id) if chat.character_id else None
            if c is None or c.is_removed:
                raise TurnError(410, "This character is no longer available")
            speakers = [c]

    if not speakers:
        raise TurnError(400, "No character available to reply")
    if content is not None:
        await chat_engine.bump_interactions(db, [s.id for s in speakers])
    for sp in speakers:
        yield {"type": "typing", "chat_id": chat.id, "character_id": sp.id, "name": sp.name}
        async for ev in chat_engine.generate(db, chat, user, sp, regenerate=regenerate):
            yield ev


def sse(events: AsyncIterator[dict[str, Any]]) -> StreamingResponse:
    async def body() -> AsyncIterator[bytes]:
        try:
            async for ev in events:
                yield f"data: {json.dumps(ev)}\n\n".encode()
        except TurnError as e:
            yield f"data: {json.dumps({'type': 'error', 'status': e.status_code, 'detail': e.detail})}\n\n".encode()
        yield b"data: [DONE]\n\n"

    return StreamingResponse(
        body(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


async def _chat_list_item(db: AsyncSession, chat: Chat) -> ChatListItem:
    item = ChatListItem.model_validate(chat)
    if chat.character_id:
        c = await db.get(Character, chat.character_id)
        item.character = CharacterCard.model_validate(c) if c else None
    if chat.room_id:
        room = await db.get(Room, chat.room_id)
        if room:
            item.room_name = room.name
            item.room_avatars = [m.character.avatar_url for m in room.members][:4]
    last = await last_message(db, chat)
    item.last_message = last.text[:140] if last else ""
    return item


# ---------- chats ----------
@router.get("/chats", response_model=list[ChatListItem])
async def list_chats(db: DB, user: CurrentUser, limit: int = Query(100, le=200)) -> list:
    chats = await db.scalars(
        select(Chat).where(Chat.user_id == user.id).order_by(Chat.updated_at.desc()).limit(limit)
    )
    return [await _chat_list_item(db, c) for c in chats]


@router.get("/characters/{character_id}/chats", response_model=list[ChatListItem])
async def character_chats(character_id: str, db: DB, user: CurrentUser) -> list:
    chats = await db.scalars(
        select(Chat)
        .where(Chat.user_id == user.id, Chat.character_id == character_id)
        .order_by(Chat.updated_at.desc())
    )
    return [await _chat_list_item(db, c) for c in chats]


@router.post("/chats", response_model=ChatOut, status_code=201)
async def create_chat(body: ChatCreate, db: DB, user: CurrentUser) -> Chat:
    if bool(body.character_id) == bool(body.room_id):
        raise HTTPException(400, "Provide exactly one of character_id or room_id")
    if body.persona_id:
        p = await db.get(Persona, body.persona_id)
        if p is None or p.user_id != user.id:
            raise HTTPException(400, "Unknown persona")
    if body.character_id:
        c = await get_visible(db, body.character_id, user)
        return await chat_engine.create_chat(db, user, c, persona_id=body.persona_id)
    room = await db.get(Room, body.room_id)
    if room is None or room.owner_id != user.id:
        raise HTTPException(404, "Room not found")
    return await chat_engine.create_chat(db, user, None, room=room, persona_id=body.persona_id)


@router.get("/chats/{chat_id}", response_model=ChatDetail)
async def get_chat(
    chat_id: str,
    db: DB,
    user: CurrentUser,
    before: int | None = None,
    limit: int = Query(60, ge=1, le=200),
) -> ChatDetail:
    chat = await owned_chat(db, chat_id, user)
    msgs = await chat_engine.history(db, chat, before=before, limit=limit + 1)
    has_more = len(msgs) > limit
    msgs = msgs[-limit:]
    detail = ChatDetail.model_validate(
        {**ChatOut.model_validate(chat).model_dump(), "messages": [], "has_more": has_more}
    )
    detail.messages = [MessageOut.model_validate(m) for m in msgs]
    if chat.character_id:
        c = await db.get(Character, chat.character_id)
        if c:
            detail.character = to_out(c, user)
    if chat.room_id:
        room = await db.get(Room, chat.room_id)
        if room:
            detail.room = RoomOut.model_validate(room)
    return detail


@router.patch("/chats/{chat_id}", response_model=ChatOut)
async def update_chat(chat_id: str, body: ChatUpdate, db: DB, user: CurrentUser) -> Chat:
    chat = await owned_chat(db, chat_id, user)
    data = body.model_dump(exclude_unset=True)
    if data.get("persona_id"):
        p = await db.get(Persona, data["persona_id"])
        if p is None or p.user_id != user.id:
            raise HTTPException(400, "Unknown persona")
    for k, v in data.items():
        setattr(chat, k, v)
    await db.commit()
    return chat


@router.delete("/chats/{chat_id}", status_code=204)
async def delete_chat(chat_id: str, db: DB, user: CurrentUser) -> None:
    chat = await owned_chat(db, chat_id, user)
    await db.delete(chat)
    await db.commit()


# ---------- turns (SSE) ----------
@router.post("/chats/{chat_id}/messages", dependencies=[chat_limit])
async def send_message(chat_id: str, body: SendMessageIn, db: DB, user: CurrentUser):
    chat = await owned_chat(db, chat_id, user)
    return sse(run_turn(db, chat, user, content=body.content))


@router.post("/chats/{chat_id}/messages/{message_id}/regenerate", dependencies=[chat_limit])
async def regenerate(chat_id: str, message_id: str, db: DB, user: CurrentUser):
    chat = await owned_chat(db, chat_id, user)
    return sse(run_turn(db, chat, user, regenerate_id=message_id))


@router.post("/chats/{chat_id}/next", dependencies=[chat_limit])
async def next_turn(chat_id: str, db: DB, user: CurrentUser, character_id: str | None = None):
    """Rooms: let a character speak without a new user message."""
    chat = await owned_chat(db, chat_id, user)
    if not chat.room_id:
        raise HTTPException(400, "Only rooms support next-turn")
    return sse(run_turn(db, chat, user, speaker_id=character_id))


# ---------- message ops ----------
@router.patch("/messages/{message_id}", response_model=MessageOut)
async def edit_message(message_id: str, body: EditMessageIn, db: DB, user: CurrentUser) -> Message:
    msg, _ = await owned_message(db, message_id, user)
    sel = msg.selected
    if sel is None:
        raise HTTPException(400, "Message has no content")
    sel.content = body.content
    # keep pinned memory text in sync
    pin = await db.scalar(select(Memory).where(Memory.message_id == msg.id))
    if pin:
        pin.content = body.content[:2000]
    await db.commit()
    await db.refresh(msg)
    return msg


@router.delete("/messages/{message_id}", status_code=204)
async def delete_message(
    message_id: str, db: DB, user: CurrentUser, and_after: bool = False
) -> None:
    msg, chat = await owned_message(db, message_id, user)
    if and_after:
        await db.execute(
            delete(Message).where(Message.chat_id == chat.id, Message.position >= msg.position)
        )
    else:
        await db.delete(msg)
    await db.commit()


@router.post("/messages/{message_id}/select", response_model=MessageOut)
async def select_candidate(
    message_id: str, body: SelectCandidateIn, db: DB, user: CurrentUser
) -> Message:
    msg, _ = await owned_message(db, message_id, user)
    if body.candidate_id not in {c.id for c in msg.candidates}:
        raise HTTPException(400, "Candidate not on this message")
    msg.selected_candidate_id = body.candidate_id
    await db.commit()
    return msg


@router.post("/candidates/{candidate_id}/rate", response_model=MessageOut)
async def rate(candidate_id: str, body: RateIn, db: DB, user: CurrentUser) -> Message:
    cand = await db.get(MessageCandidate, candidate_id)
    if cand is None:
        raise HTTPException(404, "Candidate not found")
    msg, _ = await owned_message(db, cand.message_id, user)
    if msg.role != "assistant":
        raise HTTPException(400, "Only replies can be rated")
    cand.rating = body.rating
    await db.commit()
    await db.refresh(msg)
    return msg


@router.post("/messages/{message_id}/pin", response_model=MemoryOut)
async def pin(message_id: str, db: DB, user: CurrentUser) -> Memory:
    msg, chat = await owned_message(db, message_id, user)
    existing = await db.scalar(select(Memory).where(Memory.message_id == msg.id))
    if existing:
        return existing
    count = await db.scalar(
        select(func.count(Memory.id)).where(Memory.chat_id == chat.id, Memory.kind == "pinned")
    )
    if (count or 0) >= 50:
        raise HTTPException(400, "Pinned memory limit reached (50)")
    mem = Memory(chat_id=chat.id, kind="pinned", content=msg.text[:2000], message_id=msg.id)
    msg.is_pinned = True
    db.add(mem)
    await db.commit()
    return mem


@router.delete("/messages/{message_id}/pin", status_code=204)
async def unpin(message_id: str, db: DB, user: CurrentUser) -> None:
    msg, _ = await owned_message(db, message_id, user)
    await db.execute(delete(Memory).where(Memory.message_id == msg.id))
    msg.is_pinned = False
    await db.commit()


# ---------- memories ----------
@router.get("/chats/{chat_id}/memories", response_model=list[MemoryOut])
async def list_memories(chat_id: str, db: DB, user: CurrentUser) -> list[Memory]:
    chat = await owned_chat(db, chat_id, user)
    rows = await db.scalars(
        select(Memory).where(Memory.chat_id == chat.id).order_by(Memory.created_at.desc())
    )
    return list(rows)


@router.post("/chats/{chat_id}/memories", response_model=MemoryOut, status_code=201)
async def add_memory(chat_id: str, body: MemoryIn, db: DB, user: CurrentUser) -> Memory:
    chat = await owned_chat(db, chat_id, user)
    mem = Memory(chat_id=chat.id, kind="pinned", content=body.content)
    db.add(mem)
    await db.commit()
    return mem


@router.patch("/memories/{memory_id}", response_model=MemoryOut)
async def edit_memory(memory_id: str, body: MemoryIn, db: DB, user: CurrentUser) -> Memory:
    mem = await db.get(Memory, memory_id)
    if mem is None:
        raise HTTPException(404, "Memory not found")
    await owned_chat(db, mem.chat_id, user)
    mem.content = body.content
    await db.commit()
    return mem


@router.delete("/memories/{memory_id}", status_code=204)
async def delete_memory(memory_id: str, db: DB, user: CurrentUser) -> None:
    mem = await db.get(Memory, memory_id)
    if mem is None:
        raise HTTPException(404, "Memory not found")
    await owned_chat(db, mem.chat_id, user)
    if mem.message_id:
        m = await db.get(Message, mem.message_id)
        if m:
            m.is_pinned = False
    await db.delete(mem)
    await db.commit()


# ---------- models ----------
@router.get("/models")
async def models(db: DB, user: CurrentUser) -> list[dict]:
    cfg = await settings_store.load(db)
    out = [{"id": cfg["llm_model"], "label": cfg["llm_model"], "default": True}]
    for e in cfg.get("llm_models") or []:
        e = {"id": e} if isinstance(e, str) else e
        if e.get("id") and e["id"] != cfg["llm_model"]:
            out.append({"id": e["id"], "label": e.get("label") or e["id"], "default": False})
    return out
