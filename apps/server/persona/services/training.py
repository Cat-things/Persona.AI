"""Export chats as fine-tuning data (SFT + preference pairs) for training your own model.

What gets exported, and what doesn't:
- Only chats of users who opted in (Settings → "Help train this instance's model").
- Only 1:1 chats with characters that are public, or owned by that same user.
- Every message passes the content filter with **all** categories forced on; one hit drops
  the whole conversation. Emails, phone numbers, URLs and the user's names are scrubbed.
- SFT rows use the same system prompt the server sends at inference time, so the trained
  model sees exactly the format it will be used with.
- Assistant turns are weighted: rated >= min_rating -> 1 (learn from it), everything else 0
  (context only). Swipes with different star ratings become chosen/rejected pairs (DPO).
"""

from __future__ import annotations

import json
import re
from collections.abc import AsyncIterator
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from persona.models import Character, Chat, Message, Persona, User
from persona.services import content_filter, settings_store
from persona.services.prompt import CharacterSpec, PromptInput, build

USER_NAME = "User"
STRICT = {"content_filter": True, "filter_categories": list(content_filter.CATEGORY_LABELS)}

_EMAIL = re.compile(r"[\w.+-]+@[\w-]+\.[\w.-]+")
_URL = re.compile(r"\bhttps?://\S+|\bwww\.\S+", re.I)
_PHONE = re.compile(r"(?<!\w)\+?\d[\d ().-]{7,}\d(?!\w)")


@dataclass
class ExportStats:
    users: int = 0
    chats_seen: int = 0
    chats_exported: int = 0
    dropped_filter: int = 0
    dropped_unrated: int = 0
    sft_rows: int = 0
    dpo_rows: int = 0
    trained_turns: int = 0
    notes: list[str] = field(default_factory=list)


def scrub(text: str, names: list[str]) -> str:
    text = _EMAIL.sub("[email]", text)
    text = _URL.sub("[link]", text)
    text = _PHONE.sub("[number]", text)
    for n in sorted({n for n in names if n and len(n) >= 2}, key=len, reverse=True):
        text = re.sub(rf"(?<!\w){re.escape(n)}(?!\w)", USER_NAME, text)
    return text


def _system_prompt(c: Character, guard: str) -> str:
    spec = CharacterSpec(
        name=c.name,
        description=c.description,
        personality=c.personality,
        scenario=c.scenario,
        definition=c.definition,
    )
    res = build(
        PromptInput(character=spec, user_name=USER_NAME, context_tokens=32_768, guard=guard)
    )
    return "\n\n".join(m["content"] for m in res.messages if m["role"] == "system")


async def opted_in_users(db: AsyncSession) -> list[User]:
    users = await db.scalars(select(User).where(User.is_active.is_(True)))
    return [u for u in users if (u.preferences or {}).get("training_opt_in") is True]


async def _rows_for_chat(
    db: AsyncSession,
    chat: Chat,
    user: User,
    min_rating: int,
    include_unrated: bool,
    guard: str,
    st: ExportStats,
) -> tuple[dict[str, Any] | None, list[dict[str, Any]]]:
    c = await db.get(Character, chat.character_id) if chat.character_id else None
    if c is None or c.is_removed:
        return None, []
    if c.visibility != "public" and c.creator_id != user.id:
        return None, []
    names = [user.username, user.display_name]
    personas = await db.scalars(select(Persona.name).where(Persona.user_id == user.id))
    names += list(personas)

    msgs = list(
        await db.scalars(
            select(Message).where(Message.chat_id == chat.id).order_by(Message.position)
        )
    )
    system = scrub(_system_prompt(c, guard), names)
    card = "\n".join((c.name, c.description, c.personality, c.scenario, c.definition))
    if content_filter.check(card, STRICT).blocked:  # not `system`: the guard names the topics
        st.dropped_filter += 1
        return None, []

    out: list[dict[str, Any]] = [{"role": "system", "content": system, "weight": 0}]
    pairs: list[dict[str, Any]] = []
    learned = 0
    last_id = next((m.id for m in reversed(msgs) if m.role == "assistant"), None)
    for m in msgs:
        if m.role not in ("user", "assistant"):
            continue
        sel = m.selected
        if m.id == last_id and m.candidates:
            # Nothing follows the last reply, so the best-rated swipe can stand in for it.
            best = max(m.candidates, key=lambda x: x.rating)
            if best.rating > (sel.rating if sel else 0):
                sel = best
        if sel is None or not sel.content.strip():
            continue
        text = scrub(sel.content.strip(), names)
        if content_filter.check(text, STRICT).blocked:
            st.dropped_filter += 1
            return None, []
        if m.role == "user":
            out.append({"role": "user", "content": text, "weight": 0})
            continue
        good = sel.rating >= min_rating or (include_unrated and sel.rating == 0)
        # The greeting is written by the creator, not the model: context only.
        weight = 1 if good and m.position > 0 else 0
        learned += weight
        out.append({"role": "assistant", "content": text, "weight": weight})

        rated = [x for x in m.candidates if x.rating > 0 and x.content.strip()]
        if len(rated) >= 2:
            best = max(rated, key=lambda x: x.rating)
            worst = min(rated, key=lambda x: x.rating)
            if (
                best.rating >= min_rating
                and best.rating - worst.rating >= 2
                and best.content.strip() != worst.content.strip()
            ):
                chosen, rejected = scrub(best.content, names), scrub(worst.content, names)
                if not any(content_filter.check(t, STRICT).blocked for t in (chosen, rejected)):
                    pairs.append(
                        {
                            "prompt": [
                                {k: v for k, v in x.items() if k != "weight"} for x in out[:-1]
                            ],
                            "chosen": [{"role": "assistant", "content": chosen}],
                            "rejected": [{"role": "assistant", "content": rejected}],
                        }
                    )
    if learned == 0:
        st.dropped_unrated += 1
        return None, pairs
    # Trailing context after the last learned turn teaches nothing.
    while out and out[-1].get("weight", 0) == 0:
        out.pop()
    st.trained_turns += learned
    return {"messages": out, "meta": {"character": c.name}}, pairs


async def iter_export(
    db: AsyncSession, *, min_rating: int = 3, include_unrated: bool = False, st: ExportStats
) -> AsyncIterator[tuple[dict[str, Any] | None, list[dict[str, Any]]]]:
    users = await opted_in_users(db)
    st.users = len(users)
    # Same guard text the server adds at inference time, so training matches serving.
    guard = content_filter.guard_prompt(await settings_store.load(db))
    for u in users:
        chats = await db.scalars(
            select(Chat)
            .where(Chat.user_id == u.id, Chat.room_id.is_(None))
            .order_by(Chat.created_at)
        )
        for chat in chats:
            st.chats_seen += 1
            row, pairs = await _rows_for_chat(db, chat, u, min_rating, include_unrated, guard, st)
            if row:
                st.chats_exported += 1
            yield row, pairs


async def export(
    db: AsyncSession,
    out_dir: Path,
    *,
    min_rating: int = 3,
    include_unrated: bool = False,
) -> ExportStats:
    out_dir.mkdir(parents=True, exist_ok=True)
    st = ExportStats()
    sft_path, dpo_path = out_dir / "sft.jsonl", out_dir / "dpo.jsonl"
    with sft_path.open("w", encoding="utf-8") as sft, dpo_path.open("w", encoding="utf-8") as dpo:
        async for row, pairs in iter_export(
            db, min_rating=min_rating, include_unrated=include_unrated, st=st
        ):
            if row:
                sft.write(json.dumps(row, ensure_ascii=False) + "\n")
                st.sft_rows += 1
            for p in pairs:
                dpo.write(json.dumps(p, ensure_ascii=False) + "\n")
                st.dpo_rows += 1
    if st.users == 0:
        st.notes.append("No users have opted in (Settings → Help train this instance's model).")
    elif st.sft_rows < 200:
        st.notes.append(
            f"Only {st.sft_rows} conversations. Aim for several hundred rated chats before "
            "training, or mix in a public dataset (see training/README.md)."
        )
    (out_dir / "stats.json").write_text(json.dumps(st.__dict__, indent=2))
    return st


_ROLE = {
    "human": "user",
    "user": "user",
    "gpt": "assistant",
    "assistant": "assistant",
    "system": "system",
    "model": "assistant",
    "char": "assistant",
}


def filter_row(row: dict[str, Any]) -> dict[str, Any] | None:
    """Normalise a public dataset row (OpenAI `messages` or ShareGPT `conversations`) and drop
    it if any turn trips the strict content filter. Returns None when dropped/unusable."""
    turns = row.get("messages") or row.get("conversations") or []
    out: list[dict[str, Any]] = []
    for t in turns:
        if not isinstance(t, dict):
            return None
        role = _ROLE.get(str(t.get("role") or t.get("from") or "").lower())
        text = str(t.get("content") if "content" in t else t.get("value") or "").strip()
        if role is None or not text:
            continue
        if content_filter.check(text, STRICT).blocked:
            return None
        weight = t.get("weight", 1 if role == "assistant" else 0)
        out.append({"role": role, "content": scrub(text, []), "weight": 1 if weight else 0})
    if not any(m["role"] == "assistant" and m["weight"] for m in out):
        return None
    return {"messages": out}
