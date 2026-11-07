"""Spot model refusals ("I can't continue this conversation") and escalate warnings.

Detection is deliberately narrow: it looks for phrasing *about the conversation or request*
("I can't fulfill that request", "As an AI…"), not any in-character "I can't", so a pirate
saying "I can't help ye" isn't flagged. Replies hidden by the content filter always count.

Escalation is per user over a rolling window, across all chats:
  1-2 refusals  -> "notice"  (small banner)
  3+            -> "stop"    (full-screen popup, button unlocks after hold_seconds)
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from persona.models import Chat, Message, MessageCandidate

WINDOW = timedelta(minutes=30)
STOP_AT = 3
HOLD_STEP = 5  # seconds added per refusal past STOP_AT - 1
HOLD_MAX = 30

_CANT = r"(?:can ?not|can't|won't|will not|am not able to|'m not able to|am unable to|'m unable to)"
_ACT = (
    r"(?:continue|fulfil+|comply|assist|help with (?:that|this|your)|engage|participate|"
    r"accommodate|create (?:that|this|such|content)|generate|write (?:that|this|content)|"
    r"provide (?:that|this|information|content|guidance)|produce|roleplay|role-play|go (?:there|any further)|"
    r"proceed|do that)"
)
_PATTERNS = [
    re.compile(rf"\bI {_CANT} {_ACT}\b", re.I),
    re.compile(rf"\bI(?:'m| am) (?:sorry|afraid),? (?:but )?I {_CANT}\b", re.I),
    re.compile(r"\bas an AI\b|\bas a language model\b|\bI'm (?:just )?an AI\b", re.I),
    re.compile(
        r"\b(?:this|that|your) (?:request|conversation|content|scenario) "
        r"(?:violates|goes against|is against|isn't something I)",
        re.I,
    ),
    re.compile(r"\bI (?:must|have to|need to) (?:decline|refuse|stop (?:here|this))\b", re.I),
    re.compile(r"\bI (?:don't|do not) feel comfortable (?:continuing|writing|engaging)\b", re.I),
]
_HEAD = 400  # refusals open the reply; ignore long in-story text further down


def is_refusal(text: str) -> bool:
    head = text.replace("’", "'").replace("‘", "'")[:_HEAD]
    head = re.sub(r"\*[^*]*\*", " ", head)  # in-character actions don't count
    return any(p.search(head) for p in _PATTERNS)


@dataclass
class RefusalNotice:
    count: int  # refusals in the window, including this one
    level: str  # "notice" | "stop"
    hold_seconds: int  # how long the stop popup keeps its button locked

    def as_dict(self) -> dict:
        return {"count": self.count, "level": self.level, "hold_seconds": self.hold_seconds}


async def recent_count(db: AsyncSession, user_id: str) -> int:
    since = datetime.now(UTC) - WINDOW
    q = (
        select(func.count())
        .select_from(MessageCandidate)
        .join(Message, Message.id == MessageCandidate.message_id)
        .join(Chat, Chat.id == Message.chat_id)
        .where(
            Chat.user_id == user_id,
            MessageCandidate.is_refusal.is_(True),
            MessageCandidate.created_at >= since,
        )
    )
    return int(await db.scalar(q) or 0)


def notice_for(count: int) -> RefusalNotice:
    if count >= STOP_AT:
        hold = min(HOLD_MAX, HOLD_STEP * (count - STOP_AT + 1))
        return RefusalNotice(count, "stop", hold)
    return RefusalNotice(count, "notice", 0)
