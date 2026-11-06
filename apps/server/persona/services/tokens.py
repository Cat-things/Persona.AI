"""Token counting. Uses tiktoken when installed, otherwise a fast conservative heuristic.

Local models use many tokenizers; exact counts aren't knowable server-side, so the heuristic
deliberately over-estimates slightly (≈3.6 chars/token + per-message overhead).
"""

from __future__ import annotations

import math
from functools import lru_cache

MESSAGE_OVERHEAD = 4


@lru_cache(maxsize=1)
def _encoder():
    try:
        import tiktoken

        return tiktoken.get_encoding("cl100k_base")
    except Exception:  # noqa: BLE001
        return None


def count(text: str) -> int:
    if not text:
        return 0
    enc = _encoder()
    if enc is not None:
        return len(enc.encode(text, disallowed_special=()))
    return math.ceil(len(text) / 3.6)


def count_message(msg: dict[str, str]) -> int:
    return count(msg.get("content", "")) + MESSAGE_OVERHEAD


def truncate(text: str, max_tokens: int) -> str:
    if count(text) <= max_tokens:
        return text
    enc = _encoder()
    if enc is not None:
        return enc.decode(enc.encode(text, disallowed_special=())[:max_tokens])
    return text[: int(max_tokens * 3.6)]
