"""Health checks used by `persona doctor`, the installer and the admin panel."""

from __future__ import annotations

import shutil
from typing import Any

import httpx
from sqlalchemy import text

from persona.core.config import get_settings
from persona.db import sessionmaker
from persona.services import settings_store


def _r(name: str, status: str, detail: str, critical: bool = False) -> dict[str, Any]:
    return {"name": name, "status": status, "detail": detail, "critical": critical}


async def _http_ok(url: str, headers: dict | None = None) -> tuple[bool, str]:
    try:
        async with httpx.AsyncClient(timeout=5) as c:
            r = await c.get(url, headers=headers or {})
        return r.status_code < 500, f"HTTP {r.status_code}"
    except httpx.HTTPError as e:
        return False, type(e).__name__


async def run_checks() -> list[dict[str, Any]]:
    s = get_settings()
    out: list[dict[str, Any]] = []

    out.append(
        _r(
            "secret_key",
            "fail" if s.secret_key == "change-me-dev-only" else "ok",
            "default dev secret in use" if s.secret_key == "change-me-dev-only" else "set",
            critical=s.environment == "production",
        )
    )

    cfg: dict[str, Any] = settings_store.env_defaults()
    try:
        async with sessionmaker()() as db:
            await db.execute(text("SELECT 1"))
            cfg = await settings_store.load(db, fresh=True)
        out.append(_r("database", "ok", s.db_url.split("://")[0], critical=True))
    except Exception as e:  # noqa: BLE001
        out.append(_r("database", "fail", f"{type(e).__name__}: {e}", critical=True))

    try:
        s.data_dir.mkdir(parents=True, exist_ok=True)
        probe = s.data_dir / ".write-test"
        probe.write_text("ok")
        probe.unlink()
        free_gb = shutil.disk_usage(s.data_dir).free / 1e9
        out.append(
            _r(
                "data_dir",
                "warn" if free_gb < 2 else "ok",
                f"{s.data_dir.resolve()} ({free_gb:.1f} GB free)",
                critical=True,
            )
        )
    except OSError as e:
        out.append(_r("data_dir", "fail", str(e), critical=True))

    if s.redis_url:
        try:
            import redis.asyncio as redis

            r = redis.from_url(s.redis_url)
            await r.ping()
            out.append(_r("redis", "ok", "reachable"))
        except Exception as e:  # noqa: BLE001
            out.append(_r("redis", "warn", f"unreachable ({type(e).__name__}), using memory"))
    else:
        out.append(_r("redis", "skip", "not configured (optional)"))

    # LLM
    base = cfg["llm_base_url"].rstrip("/")
    if cfg["llm_provider"] == "anthropic":
        ok, why = bool(cfg["llm_api_key"]), "API key set" if cfg["llm_api_key"] else "no API key"
    else:
        headers = {"Authorization": f"Bearer {cfg['llm_api_key']}"} if cfg["llm_api_key"] else {}
        ok, why = await _http_ok(f"{base}/models", headers)
    out.append(_r("llm", "ok" if ok else "fail", f"{cfg['llm_model']} @ {base}: {why}"))

    # Image
    if cfg["image_provider"]:
        if cfg["image_provider"] in ("comfyui", "a1111") and cfg["image_base_url"]:
            path = "/system_stats" if cfg["image_provider"] == "comfyui" else "/sdapi/v1/options"
            ok, why = await _http_ok(cfg["image_base_url"].rstrip("/") + path)
        else:
            ok, why = (
                bool(cfg["image_api_key"]),
                "API key set" if cfg["image_api_key"] else "no key",
            )
        out.append(_r("image_gen", "ok" if ok else "warn", f"{cfg['image_provider']}: {why}"))
    else:
        out.append(_r("image_gen", "skip", "not configured"))

    # TTS / STT
    from persona.services.tts import registry as tts_registry

    tts = await tts_registry.status(cfg)
    out.append(_r("tts", "ok" if tts["available"] else "warn", tts["detail"]))
    from persona.services.stt import registry as stt_registry

    stt = await stt_registry.status(cfg)
    out.append(_r("stt", "ok" if stt["available"] else "warn", stt["detail"]))

    if shutil.which("ffmpeg"):
        out.append(_r("ffmpeg", "ok", "found"))
    else:
        out.append(_r("ffmpeg", "warn", "not found (needed to decode uploaded audio for cloning)"))
    return out
