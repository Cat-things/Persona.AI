"""Runtime instance settings: DB values layered over .env defaults.

Secret fields (API keys) are write-only from the API's point of view: `public_view` masks them.
"""

from __future__ import annotations

import time
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from persona.core.config import get_settings
from persona.models import SettingKV

SECRET_KEYS = {"llm_api_key", "image_api_key", "tts_api_key", "stt_api_key"}

# key -> (type, description). Everything editable from the admin panel.
EDITABLE: dict[str, type] = {
    "instance_name": str,
    "invite_only": bool,
    "allow_registration": bool,
    "content_filter": bool,
    "filter_categories": list,
    "llm_provider": str,
    "llm_base_url": str,
    "llm_api_key": str,
    "llm_model": str,
    "llm_context_tokens": int,
    "llm_max_response_tokens": int,
    "llm_models": list,  # extra models offered for per-character override
    "image_provider": str,
    "image_base_url": str,
    "image_api_key": str,
    "image_model": str,
    "comfyui_workflow": str,
    "tts_provider": str,
    "tts_base_url": str,
    "tts_api_key": str,
    "stt_provider": str,
    "stt_model": str,
    "stt_base_url": str,
    "stt_api_key": str,
    "featured_character_ids": list,
}

DEFAULT_FILTER_CATEGORIES = ["sexual_explicit", "graphic_violence", "self_harm"]

_cache: tuple[float, dict[str, Any]] | None = None
_TTL = 5.0


def env_defaults() -> dict[str, Any]:
    s = get_settings()
    return {
        "instance_name": s.app_name,
        "invite_only": s.invite_only,
        "allow_registration": s.allow_registration,
        "content_filter": s.content_filter,
        "filter_categories": list(DEFAULT_FILTER_CATEGORIES),
        "llm_provider": s.llm_provider,
        "llm_base_url": s.llm_base_url,
        "llm_api_key": s.llm_api_key,
        "llm_model": s.llm_model,
        "llm_context_tokens": s.llm_context_tokens,
        "llm_max_response_tokens": s.llm_max_response_tokens,
        "llm_models": [],
        "image_provider": s.image_provider,
        "image_base_url": s.image_base_url,
        "image_api_key": s.image_api_key,
        "image_model": s.image_model,
        "comfyui_workflow": "",
        "tts_provider": s.tts_provider,
        "tts_base_url": s.tts_base_url,
        "tts_api_key": s.tts_api_key,
        "stt_provider": s.stt_provider,
        "stt_model": s.stt_model,
        "stt_base_url": s.stt_base_url,
        "stt_api_key": s.stt_api_key,
        "featured_character_ids": [],
    }


async def load(db: AsyncSession, *, fresh: bool = False) -> dict[str, Any]:
    global _cache
    if not fresh and _cache and time.monotonic() - _cache[0] < _TTL:
        return dict(_cache[1])
    merged = env_defaults()
    rows = (await db.execute(select(SettingKV))).scalars().all()
    for row in rows:
        if row.key in EDITABLE:
            merged[row.key] = row.value
    _cache = (time.monotonic(), merged)
    return dict(merged)


def invalidate() -> None:
    global _cache
    _cache = None


def mask(value: Any) -> str:
    if not value:
        return ""
    v = str(value)
    return "••••" + v[-4:] if len(v) > 8 else "••••"


def public_view(values: dict[str, Any]) -> dict[str, Any]:
    out = {}
    for k, v in values.items():
        if k in SECRET_KEYS:
            out[k] = mask(v)
            out[f"{k}_set"] = bool(v)
        else:
            out[k] = v
    return out


def _coerce(key: str, value: Any) -> Any:
    typ = EDITABLE[key]
    if typ is bool:
        if isinstance(value, str):
            return value.lower() in {"1", "true", "yes", "on"}
        return bool(value)
    if typ is int:
        return int(value)
    if typ is list:
        if not isinstance(value, list):
            raise ValueError(f"{key} must be a list")
        return value
    return "" if value is None else str(value)


async def update(db: AsyncSession, changes: dict[str, Any]) -> dict[str, Any]:
    for key, value in changes.items():
        if key not in EDITABLE:
            raise KeyError(key)
        # A masked value coming back from the UI means "unchanged".
        if key in SECRET_KEYS and isinstance(value, str) and value.startswith("••••"):
            continue
        row = await db.get(SettingKV, key)
        coerced = _coerce(key, value)
        if row is None:
            db.add(SettingKV(key=key, value=coerced))
        else:
            row.value = coerced
    await db.commit()
    invalidate()
    return await load(db, fresh=True)
