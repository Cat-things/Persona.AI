"""TTS provider registry (implemented in phase 6)."""

from __future__ import annotations

from typing import Any


async def status(cfg: dict[str, Any]) -> dict[str, Any]:
    return {
        "available": False,
        "detail": f"{cfg.get('tts_provider') or 'none'}: not implemented yet",
    }
