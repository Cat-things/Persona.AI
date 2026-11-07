"""Chat engine: user messages, streaming replies, swipes (candidates), rooms."""

from __future__ import annotations

import logging
from collections.abc import AsyncIterator
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from persona.models import Character, Chat, Message, MessageCandidate, Persona, Room, User
from persona.schemas import MessageOut
from persona.services import content_filter, memory, settings_store
from persona.services.llm.base import LLMError, resolve_target, stream_chat
from persona.services.prompt import CharacterSpec, PromptInput, Turn, build, clean_reply, macros

log = logging.getLogger("persona.chat")
HISTORY_FETCH = 400  # most recent messages considered for the prompt window
FILTER_CHECK_EVERY = 120  # chars


def message_out(m: Message) -> dict[str, Any]:
    return MessageOut.model_validate(m).model_dump(mode="json")


async def user_display_name(db: AsyncSession, chat: Chat, user: User) -> tuple[str, str]:
    persona = await db.get(Persona, chat.persona_id) if chat.persona_id else None
    if persona:
        return persona.name, persona.description
    return user.display_name or user.username, ""


async def _next_position(db: AsyncSession, chat: Chat) -> int:
    # Atomic increment so concurrent sends can't collide.
    await db.execute(
        update(Chat).where(Chat.id == chat.id).values(next_position=Chat.next_position + 1)
    )
    await db.refresh(chat, ["next_position"])
    return chat.next_position - 1


async def add_message(
    db: AsyncSession,
    chat: Chat,
    role: str,
    content: str,
    character_id: str | None = None,
    model: str = "",
) -> Message:
    pos = await _next_position(db, chat)
    msg = Message(chat_id=chat.id, position=pos, role=role, character_id=character_id)
    cand = MessageCandidate(content=content, model=model)
    msg.candidates.append(cand)
    db.add(msg)
    await db.flush()
    msg.selected_candidate_id = cand.id
    chat.updated_at = datetime.now(UTC)
    await db.commit()
    await db.refresh(msg)
    return msg


async def create_chat(
    db: AsyncSession,
    user: User,
    character: Character | None,
    room: Room | None = None,
    persona_id: str | None = None,
) -> Chat:
    if persona_id is None:
        pid = (user.preferences or {}).get("default_persona_id")
        if pid and (p := await db.get(Persona, pid)) and p.user_id == user.id:
            persona_id = pid
        else:
            persona_id = await db.scalar(
                select(Persona.id).where(Persona.user_id == user.id, Persona.is_default.is_(True))
            )
    chat = Chat(
        user_id=user.id,
        character_id=character.id if character else None,
        room_id=room.id if room else None,
        persona_id=persona_id,
        title=(character.name if character else room.name if room else "Chat"),
    )
    db.add(chat)
    await db.commit()
    uname, _ = await user_display_name(db, chat, user)
    if character and character.greeting.strip():
        await add_message(
            db,
            chat,
            "assistant",
            macros(character.greeting, character.name, uname),
            character_id=character.id,
        )
    elif room:
        for member in room.members:
            if member.character.greeting.strip():
                await add_message(
                    db,
                    chat,
                    "assistant",
                    macros(member.character.greeting, member.character.name, uname),
                    character_id=member.character_id,
                )
                break
    return chat


async def history(
    db: AsyncSession, chat: Chat, *, before: int | None = None, limit: int = HISTORY_FETCH
) -> list[Message]:
    stmt = select(Message).where(Message.chat_id == chat.id)
    if before is not None:
        stmt = stmt.where(Message.position < before)
    rows = list(await db.scalars(stmt.order_by(Message.position.desc()).limit(limit)))
    rows.reverse()
    return rows


async def build_prompt(
    db: AsyncSession, chat: Chat, user: User, speaker: Character, upto: Message | None = None
):
    cfg = await settings_store.load(db)
    target = resolve_target(cfg, speaker.llm_model, speaker.llm_params)
    uname, persona_desc = await user_display_name(db, chat, user)
    msgs = await history(db, chat, before=upto.position if upto else None)
    room = await db.get(Room, chat.room_id) if chat.room_id else None
    names = {m.character_id: m.character.name for m in room.members} if room else {}
    turns = [
        Turn(
            role=m.role if m.role in ("user", "assistant") else "user",
            text=m.text,
            position=m.position,
            speaker=uname if m.role == "user" else names.get(m.character_id, speaker.name),
            character_id=m.character_id,
        )
        for m in msgs
        if m.text.strip()
    ]
    summary = await memory.get_summary(db, chat.id)
    pin = PromptInput(
        character=CharacterSpec(
            name=speaker.name,
            description=speaker.description,
            personality=speaker.personality,
            scenario=speaker.scenario,
            definition=speaker.definition,
        ),
        user_name=uname,
        persona=persona_desc,
        pinned=await memory.pinned_texts(db, chat.id),
        summary=summary.content if summary else "",
        history=turns,
        context_tokens=target.context_tokens,
        response_tokens=target.max_response_tokens,
        guard=content_filter.guard_prompt(cfg),
        room_members=list(names.values()) if room else [],
        room_topic=room.topic if room else "",
        speaker_id=speaker.id,
    )
    result = build(pin)
    return cfg, target, result, summary, uname, list(names.values())


async def generate(
    db: AsyncSession,
    chat: Chat,
    user: User,
    speaker: Character,
    *,
    regenerate: Message | None = None,
) -> AsyncIterator[dict[str, Any]]:
    """Stream a reply. With `regenerate`, adds a new candidate (swipe) to that message."""
    cfg, target, prompt, summary, uname, room_names = await build_prompt(
        db, chat, user, speaker, upto=regenerate
    )
    if regenerate is not None:
        msg = regenerate
    else:
        pos = await _next_position(db, chat)
        msg = Message(chat_id=chat.id, position=pos, role="assistant", character_id=speaker.id)
        db.add(msg)
        await db.flush()
    cand = MessageCandidate(message_id=msg.id, content="", model=target.model)
    db.add(cand)
    await db.flush()
    msg.selected_candidate_id = cand.id
    await db.commit()

    yield {
        "type": "start",
        "chat_id": chat.id,
        "message_id": msg.id,
        "candidate_id": cand.id,
        "character_id": speaker.id,
        "position": msg.position,
        "regenerate": regenerate is not None,
    }

    text = ""
    last_check = 0
    finish = "stop"
    blocked = False
    try:
        async for piece in stream_chat(target, prompt.messages):
            text += piece
            if len(text) - last_check >= FILTER_CHECK_EVERY:
                last_check = len(text)
                if content_filter.check(text, cfg).blocked:
                    blocked = True
                    break
            yield {"type": "delta", "candidate_id": cand.id, "text": piece}
    except LLMError as e:
        finish = "error"
        cand.content = text
        cand.finish_reason = finish
        await db.commit()
        yield {"type": "error", "candidate_id": cand.id, "detail": str(e)}
        if not text:
            await _drop_empty(db, msg, cand, regenerate is not None)
        return
    except BaseException:
        # Cancelled (stop button / disconnect): keep what we have.
        cand.content = clean_reply(text, speaker.name, uname, room_names)
        cand.finish_reason = "stopped"
        await db.commit()
        raise

    final = clean_reply(text, speaker.name, uname, room_names)
    if blocked or content_filter.check(final, cfg).blocked:
        final = content_filter.BLOCKED_REPLY
        finish = "filtered"
    cand.content = final
    cand.finish_reason = finish
    chat.updated_at = datetime.now(UTC)
    await db.commit()
    await db.refresh(msg)
    yield {"type": "done", "message": message_out(msg), "filtered": finish == "filtered"}

    if (user.preferences or {}).get("autoplay_voice") and (
        cfg.get("tts_provider") or "none"
    ) != "none":
        from persona.services import jobs

        await jobs.enqueue(db, "tts_prerender", {"message_id": msg.id}, user_id=user.id)

    covers = summary.covers_until if summary else -1
    if memory.needs_summary(prompt.first_included_position, covers):
        memory.schedule(chat.id, prompt.first_included_position or 0)


async def _drop_empty(db: AsyncSession, msg: Message, cand: MessageCandidate, regen: bool) -> None:
    if regen:
        await db.delete(cand)
        await db.flush()
        await db.refresh(msg)
        msg.selected_candidate_id = msg.candidates[-1].id if msg.candidates else None
    else:
        await db.delete(msg)
    await db.commit()


async def bump_interactions(db: AsyncSession, character_ids: list[str]) -> None:
    if character_ids:
        await db.execute(
            update(Character)
            .where(Character.id.in_(character_ids))
            .values(interaction_count=Character.interaction_count + 1)
        )
        await db.commit()


# ---------- rooms: who speaks next ----------
async def pick_speakers(
    db: AsyncSession, chat: Chat, room: Room, user_text: str | None, *, max_turns: int = 1
) -> list[Character]:
    """Turn-taking:
    - a character @mentioned / named in the user's message answers first
    - round_robin: next member after the last speaker
    - auto: mentioned characters, else whoever spoke least recently (no one speaks twice in a row)
    """
    members = [m.character for m in room.members]
    if not members:
        return []
    recent = await history(db, chat, limit=len(members) * 3)
    last_speakers = [m.character_id for m in reversed(recent) if m.role == "assistant"]
    chosen: list[Character] = []
    if user_text:
        low = user_text.lower()
        for c in members:
            first = c.name.split()[0].lower()
            if (
                f"@{first}" in low
                or f"@{c.name.lower()}" in low
                or (len(first) > 2 and _word_in(first, low))
            ):
                chosen.append(c)
    if room.turn_mode == "manual" and user_text is not None and not chosen:
        return []  # wait for the user to pick a speaker
    if room.turn_mode == "round_robin" and not chosen:
        last = last_speakers[0] if last_speakers else None
        ids = [c.id for c in members]
        idx = (ids.index(last) + 1) % len(ids) if last in ids else 0
        chosen = [members[idx]]
    if not chosen:

        def staleness(c: Character) -> int:
            return last_speakers.index(c.id) if c.id in last_speakers else 10_000

        ordered = sorted(members, key=staleness, reverse=True)
        if len(ordered) > 1 and last_speakers and ordered[0].id == last_speakers[0]:
            ordered = ordered[1:]
        chosen = ordered[:1]
    return chosen[:max_turns]


def _word_in(word: str, text: str) -> bool:
    import re

    return re.search(rf"\b{re.escape(word)}\b", text) is not None
