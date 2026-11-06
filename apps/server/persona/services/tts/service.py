"""Voice library, cached synthesis for message playback, and the pre-render job."""

from __future__ import annotations

import asyncio
import hashlib
import json
import logging
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from persona.core.config import get_settings
from persona.models import Character, Job, Message, Voice
from persona.services import audio, settings_store
from persona.services.http import ProviderError
from persona.services.jobs import handler
from persona.services.tts import registry

log = logging.getLogger("persona.tts")
_locks: dict[str, asyncio.Lock] = {}


async def sync_voices(db: AsyncSession, cfg: dict | None = None) -> int:
    """Mirror the provider's built-in voices into the library (owner = NULL)."""
    cfg = cfg or await settings_store.load(db, fresh=True)
    provider = cfg.get("tts_provider") or "none"
    if registry.provider(cfg) is None:
        return 0
    infos = await registry.list_voices(cfg)
    existing = {
        v.provider_voice_id: v
        for v in await db.scalars(
            select(Voice).where(Voice.provider == provider, Voice.owner_id.is_(None))
        )
    }
    seen = set()
    for info in infos:
        seen.add(info.id)
        v = existing.get(info.id)
        if v is None:
            db.add(
                Voice(
                    provider=provider,
                    provider_voice_id=info.id,
                    name=info.name,
                    language=info.language,
                    gender=info.gender,
                    description=info.description,
                    is_public=True,
                )
            )
        else:
            v.name, v.language, v.gender = info.name, info.language, info.gender
            v.is_public = True
    for vid, v in existing.items():
        if vid not in seen:
            v.is_public = False  # hidden, but characters keep their reference
    await db.commit()
    return len(infos)


async def default_voice(db: AsyncSession, cfg: dict) -> Voice | None:
    provider = cfg.get("tts_provider") or "none"
    preferred = {"kokoro": "af_heart", "openai": "af_heart", "mock": "mock_high"}.get(provider)
    q = select(Voice).where(
        Voice.provider == provider, Voice.owner_id.is_(None), Voice.is_public.is_(True)
    )
    if preferred:
        v = await db.scalar(q.where(Voice.provider_voice_id == preferred))
        if v:
            return v
    v = await db.scalar(q.order_by(Voice.name).limit(1))
    if v is None:
        try:
            if await sync_voices(db, cfg):
                return await db.scalar(q.order_by(Voice.name).limit(1))
        except Exception as e:  # noqa: BLE001
            log.warning("voice sync failed: %s", e)
    return v


async def voice_for_character(
    db: AsyncSession, character: Character | None, cfg: dict
) -> Voice | None:
    if character and character.voice_id:
        v = await db.get(Voice, character.voice_id)
        if v and v.provider == cfg.get("tts_provider"):
            return v
    return await default_voice(db, cfg)


def voice_ref(v: Voice) -> registry.VoiceRef:
    extra: dict[str, Any] = {"language": (v.language or "en")[:2]}
    if v.sample_path and v.provider == "xtts":
        path = get_settings().data_dir / v.sample_path
        if path.exists():
            extra["latents"] = json.loads(path.read_text())
    return registry.VoiceRef(v.provider_voice_id, v.sample_path, extra)


def _cache_key(v: Voice, text: str) -> str:
    return hashlib.sha256(f"{v.provider}|{v.provider_voice_id}|{v.id}|{text}".encode()).hexdigest()[
        :40
    ]


async def render(db: AsyncSession, voice: Voice, text: str, cfg: dict) -> tuple[bytes, str]:
    """Synthesize (or fetch from cache) playable audio for text. Returns (bytes, mime)."""
    clean = audio.speakable(text)
    if not clean:
        raise ProviderError("Nothing to read aloud in this message")
    key = _cache_key(voice, clean)
    cache_dir = get_settings().data_dir / "cache" / "tts"
    cache_dir.mkdir(parents=True, exist_ok=True)
    for ext, mime in (("mp3", "audio/mpeg"), ("wav", "audio/wav")):
        p = cache_dir / f"{key}.{ext}"
        if p.exists():
            return p.read_bytes(), mime
    lock = _locks.setdefault(key, asyncio.Lock())
    async with lock:
        for ext, mime in (("mp3", "audio/mpeg"), ("wav", "audio/wav")):
            p = cache_dir / f"{key}.{ext}"
            if p.exists():
                return p.read_bytes(), mime
        speech = await registry.speak(cfg, voice_ref(voice), clean)
        wav = audio.pcm16_to_wav(speech.pcm, speech.rate)
        data, mime = await audio.to_mp3(wav)
        ext = "mp3" if mime == "audio/mpeg" else "wav"
        (cache_dir / f"{key}.{ext}").write_bytes(data)
    _locks.pop(key, None)
    return data, mime


async def render_message(db: AsyncSession, msg: Message) -> tuple[bytes, str]:
    cfg = await settings_store.load(db)
    char = await db.get(Character, msg.character_id) if msg.character_id else None
    voice = await voice_for_character(db, char, cfg)
    if voice is None:
        raise ProviderError("No voices are available on this server")
    return await render(db, voice, msg.text, cfg)


@handler("tts_prerender")
async def prerender_job(db: AsyncSession, job: Job) -> dict[str, Any]:
    msg = await db.get(Message, job.payload["message_id"])
    if msg is None:
        return {"skipped": True}
    _, mime = await render_message(db, msg)
    return {"mime": mime}
