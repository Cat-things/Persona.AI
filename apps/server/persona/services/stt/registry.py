"""Speech-to-text providers. Input is always mono PCM16 at 16 kHz.

faster-whisper  in-process (CUDA when available, CPU int8 fallback)
openai          OpenAI-compatible /audio/transcriptions (OpenAI, Speaches, ...)
mock            deterministic text (tests, demos)
none            off
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any

import numpy as np

from persona.core.config import get_settings
from persona.services import audio
from persona.services.http import ProviderError, client, raise_for

log = logging.getLogger("persona.stt")
RATE = 16000

_model = None
_model_key: tuple | None = None
_model_lock = asyncio.Lock()


def _device() -> tuple[str, str]:
    want = get_settings().stt_device
    if want in ("cuda", "cpu"):
        return want, "int8_float16" if want == "cuda" else "int8"
    try:
        import ctranslate2

        if ctranslate2.get_cuda_device_count() > 0:
            return "cuda", "int8_float16"
    except Exception:  # noqa: BLE001
        pass
    return "cpu", "int8"


async def _whisper(cfg: dict):
    global _model, _model_key
    name = cfg.get("stt_model") or "small"
    device, compute = _device()
    key = (name, device, compute)
    if _model is not None and _model_key == key:
        return _model
    async with _model_lock:
        if _model is not None and _model_key == key:
            return _model
        try:
            from faster_whisper import WhisperModel
        except ImportError as e:
            raise ProviderError(
                "faster-whisper isn't installed. Install the server with the 'stt' extra "
                "(uv sync --extra stt) or use the Docker 'stt' profile."
            ) from e
        root = get_settings().data_dir / "models" / "whisper"
        log.info("loading faster-whisper %s on %s (%s)", name, device, compute)
        try:
            _model = await asyncio.to_thread(
                WhisperModel, name, device=device, compute_type=compute, download_root=str(root)
            )
        except Exception as e:  # noqa: BLE001  CUDA libs missing etc. -> CPU
            if device == "cpu":
                raise
            log.warning("CUDA load failed (%s); falling back to CPU", e)
            device, compute = "cpu", "int8"
            _model = await asyncio.to_thread(
                WhisperModel, name, device=device, compute_type=compute, download_root=str(root)
            )
        _model_key = (name, device, compute)
        return _model


async def whisper_transcribe(cfg: dict, pcm: bytes, language: str | None) -> str:
    model = await _whisper(cfg)
    samples = np.frombuffer(pcm, dtype="<i2").astype(np.float32) / 32768.0

    def run() -> str:
        segments, _ = model.transcribe(
            samples,
            language=language,
            beam_size=1,
            vad_filter=False,
            condition_on_previous_text=False,
            without_timestamps=True,
        )
        return " ".join(s.text.strip() for s in segments).strip()

    return await asyncio.to_thread(run)


async def openai_transcribe(cfg: dict, pcm: bytes, language: str | None) -> str:
    base = (cfg.get("stt_base_url") or "https://api.openai.com/v1").rstrip("/")
    model = cfg.get("stt_model") or "whisper-1"
    if model in ("tiny", "base", "small", "medium", "large-v3") and "api.openai.com" in base:
        model = "whisper-1"
    headers = {"Authorization": f"Bearer {cfg['stt_api_key']}"} if cfg.get("stt_api_key") else {}
    data = {"model": model, "response_format": "json"}
    if language:
        data["language"] = language
    wav = audio.pcm16_to_wav(pcm, RATE)
    async with client(timeout=120) as c:
        r = await c.post(
            f"{base}/audio/transcriptions",
            headers=headers,
            data=data,
            files={"file": ("speech.wav", wav, "audio/wav")},
        )
        await raise_for(r, "Transcription API")
        body = r.json()
    return (body.get("text") if isinstance(body, dict) else str(body) or "").strip()


MOCK_TEXT = "Hello there, how are you today?"


async def mock_transcribe(cfg: dict, pcm: bytes, language: str | None) -> str:
    # Silence/very short audio transcribes to nothing, like a real model.
    if len(pcm) < RATE * 2 * 0.25:
        return ""
    return MOCK_TEXT


PROVIDERS = {
    "faster-whisper": whisper_transcribe,
    "openai": openai_transcribe,
    "mock": mock_transcribe,
}

# Whisper hallucinates these on silence / noise.
_HALLUCINATIONS = {
    "you",
    "thank you.",
    "thanks for watching!",
    "thank you for watching.",
    "bye.",
    ".",
    "subtitles by the amara.org community",
}


async def transcribe(cfg: dict[str, Any], pcm: bytes, language: str | None = None) -> str:
    fn = PROVIDERS.get(cfg.get("stt_provider") or "none")
    if fn is None:
        raise ProviderError("Speech recognition is turned off on this server")
    if not pcm:
        return ""
    text = await fn(cfg, pcm, language)
    if text.strip().lower() in _HALLUCINATIONS:
        return ""
    return text


async def status(cfg: dict[str, Any]) -> dict[str, Any]:
    name = cfg.get("stt_provider") or "none"
    if name == "none":
        return {"available": False, "detail": "off"}
    if name == "faster-whisper":
        try:
            import faster_whisper  # noqa: F401
        except ImportError:
            return {
                "available": False,
                "detail": "faster-whisper not installed (stt extra or Docker 'stt' profile)",
            }
        device, compute = _device()
        return {
            "available": True,
            "detail": f"faster-whisper {cfg.get('stt_model') or 'small'} on {device} ({compute})",
        }
    if name == "openai":
        base = cfg.get("stt_base_url") or "https://api.openai.com/v1"
        return {"available": True, "detail": f"OpenAI-compatible at {base}"}
    return {"available": True, "detail": name}
