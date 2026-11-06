"""Rolling summarization of long chats + pinned memory helpers."""

from __future__ import annotations

import asyncio
import logging

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from persona.db import sessionmaker
from persona.models import Character, Chat, Memory, Message, Persona, User
from persona.services import settings_store, tokens
from persona.services.llm.base import LLMError, complete, resolve_target

log = logging.getLogger("persona.memory")

SUMMARY_WORDS = 250
OVERLAP = 6  # summarize a few messages past the window edge to avoid retriggering every turn
_tasks: set[asyncio.Task] = set()
_locks: dict[str, asyncio.Lock] = {}


async def get_summary(db: AsyncSession, chat_id: str) -> Memory | None:
    return await db.scalar(
        select(Memory).where(Memory.chat_id == chat_id, Memory.kind == "summary")
    )


async def pinned_texts(db: AsyncSession, chat_id: str) -> list[str]:
    rows = await db.scalars(
        select(Memory)
        .where(Memory.chat_id == chat_id, Memory.kind == "pinned")
        .order_by(Memory.created_at.desc())
    )
    return [m.content for m in rows]


def needs_summary(first_included: int | None, covers_until: int) -> bool:
    """True when some messages are neither in the prompt window nor in the summary."""
    return first_included is not None and first_included > covers_until + 1


def schedule(chat_id: str, first_included: int) -> None:
    """Fire-and-forget summarization in the API process (one at a time per chat)."""
    task = asyncio.create_task(_run(chat_id, first_included))
    _tasks.add(task)
    task.add_done_callback(_tasks.discard)


async def drain() -> None:
    """Wait for pending summaries (tests)."""
    while _tasks:
        await asyncio.gather(*list(_tasks), return_exceptions=True)


async def _run(chat_id: str, first_included: int) -> None:
    lock = _locks.setdefault(chat_id, asyncio.Lock())
    if lock.locked():
        return
    async with lock:
        try:
            async with sessionmaker()() as db:
                await summarize(db, chat_id, upto=first_included - 1 + OVERLAP)
        except LLMError as e:
            log.warning("summary for chat %s failed: %s", chat_id, e)
        except Exception:  # noqa: BLE001
            log.exception("summary for chat %s crashed", chat_id)


async def summarize(db: AsyncSession, chat_id: str, upto: int) -> Memory | None:
    chat = await db.get(Chat, chat_id)
    if chat is None:
        return None
    existing = await get_summary(db, chat_id)
    start = existing.covers_until + 1 if existing else 0
    if upto < start:
        return existing
    msgs = list(
        await db.scalars(
            select(Message)
            .where(Message.chat_id == chat_id, Message.position >= start, Message.position <= upto)
            .order_by(Message.position)
        )
    )
    if not msgs:
        return existing

    user = await db.get(User, chat.user_id)
    persona = await db.get(Persona, chat.persona_id) if chat.persona_id else None
    user_name = persona.name if persona else (user.display_name if user else "User")
    names: dict[str | None, str] = {}
    char: Character | None = (
        await db.get(Character, chat.character_id) if chat.character_id else None
    )
    char_name = char.name if char else "the characters"

    async def speaker(m: Message) -> str:
        if m.role == "user":
            return user_name
        if m.character_id not in names:
            c = await db.get(Character, m.character_id) if m.character_id else None
            names[m.character_id] = c.name if c else char_name
        return names[m.character_id]

    cfg = await settings_store.load(db)
    target = resolve_target(
        cfg, char.llm_model if char else None, char.llm_params if char else None
    )
    target.max_response_tokens = 400
    # Feed the transcript in chunks that fit the model window.
    chunk_budget = max(512, target.context_tokens - 900)
    summary = existing.content if existing else ""
    batch: list[str] = []
    batch_tokens = 0
    covered = start - 1

    async def flush() -> None:
        nonlocal summary, batch, batch_tokens
        if not batch:
            return
        sys = (
            f"You maintain the running summary of a roleplay between {user_name} and {char_name}. "
            f"Merge the new messages into the summary. Third person, past tense, under "
            f"{SUMMARY_WORDS} words. Keep names, facts, relationships, promises and unresolved "
            f"threads. Output only the summary."
        )
        body = f"Current summary:\n{summary or '(none yet)'}\n\nNew messages:\n" + "\n".join(batch)
        summary = await complete(
            target, [{"role": "system", "content": sys}, {"role": "user", "content": body}]
        )
        batch, batch_tokens = [], 0

    for m in msgs:
        line = f"{await speaker(m)}: {m.text}"
        cost = tokens.count(line)
        if batch and batch_tokens + cost > chunk_budget:
            await flush()
        batch.append(tokens.truncate(line, chunk_budget))
        batch_tokens += cost
        covered = m.position
    await flush()

    if existing:
        existing.content = summary
        existing.covers_until = covered
        mem = existing
    else:
        mem = Memory(chat_id=chat_id, kind="summary", content=summary, covers_until=covered)
        db.add(mem)
    await db.commit()
    return mem
