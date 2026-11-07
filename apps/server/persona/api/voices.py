from __future__ import annotations

import json

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel, Field
from sqlalchemy import or_, select

from persona.api.chats import owned_message
from persona.core.config import get_settings
from persona.core.deps import DB, AdminUser, CurrentUser, gen_limit
from persona.models import Voice, new_id
from persona.schemas import VoiceOut
from persona.services import audio, settings_store, storage
from persona.services.http import ProviderError
from persona.services.tts import registry
from persona.services.tts.service import render, render_message, sync_voices

router = APIRouter(tags=["voices"])

PREVIEW_TEXT = "Hi there. This is how I sound. Shall we talk for a while?"


@router.get("/voices", response_model=list[VoiceOut])
async def list_voices(db: DB, user: CurrentUser) -> list[Voice]:
    cfg = await settings_store.load(db)
    provider = cfg.get("tts_provider") or "none"
    q = select(Voice).where(
        Voice.provider == provider,
        or_(Voice.is_public.is_(True), Voice.owner_id == user.id),
    )
    voices = list(await db.scalars(q.order_by(Voice.owner_id.is_(None), Voice.name)))
    if not voices and registry.provider(cfg):
        try:
            await sync_voices(db, cfg)
            voices = list(await db.scalars(q.order_by(Voice.name)))
        except Exception:  # noqa: BLE001
            voices = []
    return voices


@router.post("/voices/sync")
async def sync(db: DB, _: AdminUser) -> dict:
    try:
        n = await sync_voices(db)
    except ProviderError as e:
        raise HTTPException(502, str(e)) from e
    return {"voices": n}


class PreviewIn(BaseModel):
    text: str | None = Field(default=None, max_length=300)


def _audio_response(data: bytes, mime: str) -> Response:
    return Response(data, media_type=mime, headers={"Cache-Control": "private, max-age=86400"})


# GET aliases let native players stream the audio with an Authorization header.
@router.get("/voices/{voice_id}/preview", dependencies=[gen_limit])
@router.post("/voices/{voice_id}/preview", dependencies=[gen_limit])
async def preview(
    voice_id: str, db: DB, user: CurrentUser, body: PreviewIn | None = None
) -> Response:
    v = await db.get(Voice, voice_id)
    if v is None or not (v.is_public or v.owner_id == user.id):
        raise HTTPException(404, "Voice not found")
    cfg = await settings_store.load(db)
    try:
        data, mime = await render(db, v, (body.text if body and body.text else PREVIEW_TEXT), cfg)
    except ProviderError as e:
        raise HTTPException(502, str(e)) from e
    return _audio_response(data, mime)


@router.get("/messages/{message_id}/tts", dependencies=[gen_limit])
@router.post("/messages/{message_id}/tts", dependencies=[gen_limit])
async def message_tts(message_id: str, db: DB, user: CurrentUser) -> Response:
    msg, _ = await owned_message(db, message_id, user)
    try:
        data, mime = await render_message(db, msg)
    except ProviderError as e:
        raise HTTPException(502, str(e)) from e
    return _audio_response(data, mime)


@router.post("/voices/clone", response_model=VoiceOut, status_code=201, dependencies=[gen_limit])
async def clone_voice(
    db: DB,
    user: CurrentUser,
    file: UploadFile = File(...),
    name: str = Form(..., min_length=1, max_length=64),
    rights_confirmed: bool = Form(False),
) -> Voice:
    if not rights_confirmed:
        raise HTTPException(
            400, "Confirm that you own this recording or have permission to clone the voice."
        )
    cfg = await settings_store.load(db)
    provider = cfg.get("tts_provider") or "none"
    if not registry.can_clone(cfg):
        raise HTTPException(409, "This server's voice provider doesn't support cloning.")
    data = await storage.read_limited(file, get_settings().max_audio_mb * 1024 * 1024)
    if storage.sniff_audio(data) is None:
        raise HTTPException(415, "Unsupported audio (wav, mp3, ogg, webm, m4a, flac)")
    try:
        pcm = await audio.decode_to_pcm16(data, 24000)
    except RuntimeError as e:
        raise HTTPException(400, str(e)) from e
    seconds = len(pcm) / 2 / 24000
    if seconds < 5:
        raise HTTPException(400, "The sample is too short; use 6 to 30 seconds of clear speech.")
    wav = audio.pcm16_to_wav(pcm[: 24000 * 2 * 30], 24000)

    # Samples and latents are private: stored outside the public media dir.
    priv = get_settings().data_dir / "voice-samples"
    priv.mkdir(parents=True, exist_ok=True)
    vid = new_id()
    (priv / f"{vid}.wav").write_bytes(wav)
    sample_rel = None
    provider_voice_id = vid
    try:
        if provider == "xtts":
            latents = await registry.xtts_clone(cfg, wav)
            (priv / f"{vid}.json").write_text(json.dumps(latents))
            sample_rel = f"voice-samples/{vid}.json"
        elif provider == "elevenlabs":
            provider_voice_id = await registry.elevenlabs_clone(cfg, wav, name)
        elif provider == "mock":
            provider_voice_id = "mock_high"
    except ProviderError as e:
        raise HTTPException(502, str(e)) from e
    v = Voice(
        id=vid,
        owner_id=user.id,
        name=name.strip(),
        provider=provider,
        provider_voice_id=provider_voice_id,
        language="en",
        description="Cloned voice",
        sample_path=sample_rel,
        is_public=False,
        rights_confirmed=True,
    )
    db.add(v)
    await db.commit()
    return v


@router.delete("/voices/{voice_id}", status_code=204)
async def delete_voice(voice_id: str, db: DB, user: CurrentUser) -> None:
    v = await db.get(Voice, voice_id)
    if v is None or (v.owner_id != user.id and not user.is_admin) or v.owner_id is None:
        raise HTTPException(404, "Voice not found")
    priv = get_settings().data_dir / "voice-samples"
    for ext in ("wav", "json"):
        (priv / f"{v.id}.{ext}").unlink(missing_ok=True)
    await db.delete(v)
    await db.commit()


@router.get("/capabilities")
async def capabilities(db: DB, _: CurrentUser) -> dict:
    cfg = await settings_store.load(db)
    tts = (cfg.get("tts_provider") or "none") != "none"
    stt = (cfg.get("stt_provider") or "none") != "none"
    return {
        "tts": tts,
        "stt": stt,
        "image": bool(cfg.get("image_provider")),
        "calls": tts and stt,
        "voice_cloning": registry.can_clone(cfg),
    }
