"""Text-to-speech providers.

  kokoro      in-process kokoro-onnx (model files auto-downloaded to DATA_DIR/models/kokoro)
  piper       local `piper` binary with .onnx voices from PIPER_VOICES_DIR
  xtts        Coqui XTTS-v2 streaming server (voice cloning from a reference clip)
  elevenlabs  ElevenLabs API (voice library + instant cloning)
  openai      OpenAI-compatible /audio/speech (OpenAI, Kokoro-FastAPI, Speaches, ...)
  mock        sine-tone audio for tests and demos
  none        off

Every provider returns mono PCM16 plus its sample rate; callers convert as needed.
"""

from __future__ import annotations

import asyncio
import base64
import logging
import math
import struct
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from persona.core.config import get_settings
from persona.services import audio
from persona.services.http import ProviderError, client, raise_for

log = logging.getLogger("persona.tts")

KOKORO_MODEL_URL = (
    "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/"
    "kokoro-v1.0.onnx"
)
KOKORO_VOICES_URL = (
    "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/voices-v1.0.bin"
)
OPENAI_VOICES = ["alloy", "ash", "coral", "echo", "fable", "nova", "onyx", "sage", "shimmer"]
KOKORO_LANG = {
    "a": ("en-us", "English (US)"),
    "b": ("en-gb", "English (UK)"),
    "e": ("es", "Spanish"),
    "f": ("fr-fr", "French"),
    "h": ("hi", "Hindi"),
    "i": ("it", "Italian"),
    "j": ("ja", "Japanese"),
    "p": ("pt-br", "Portuguese"),
    "z": ("cmn", "Chinese"),
}


@dataclass
class VoiceInfo:
    id: str
    name: str
    language: str = "en"
    gender: str = ""
    description: str = ""


@dataclass
class Speech:
    pcm: bytes
    rate: int


@dataclass
class VoiceRef:
    """What a provider needs to speak with a voice."""

    provider_voice_id: str
    sample_path: str | None = None  # cloned voices
    extra: dict[str, Any] = field(default_factory=dict)


def _kokoro_meta(vid: str) -> tuple[str, str]:
    lang = KOKORO_LANG.get(vid[:1], ("en-us", "English"))[0]
    gender = {"f": "female", "m": "male"}.get(vid[1:2], "")
    return lang, gender


def _pretty(vid: str) -> str:
    return vid.split("_", 1)[-1].replace("_", " ").title() if "_" in vid else vid.title()


# ---------------------------------------------------------------- kokoro (in-process)
_kokoro = None
_kokoro_lock = asyncio.Lock()


async def _download(url: str, dest: Path) -> None:
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_suffix(dest.suffix + ".part")
    log.info("downloading %s", url)
    async with client(timeout=600, follow_redirects=True) as c, c.stream("GET", url) as r:
        await raise_for(r, "Model download")
        with tmp.open("wb") as f:
            async for chunk in r.aiter_bytes(1 << 20):
                f.write(chunk)
    tmp.rename(dest)


async def _get_kokoro():
    global _kokoro
    if _kokoro is not None:
        return _kokoro
    async with _kokoro_lock:
        if _kokoro is not None:
            return _kokoro
        try:
            from kokoro_onnx import Kokoro
        except ImportError as e:
            raise ProviderError(
                "Kokoro isn't installed. Install the server with the 'tts' extra "
                "(uv sync --extra tts) or use the Docker 'tts' profile."
            ) from e
        s = get_settings()
        model = Path(s.kokoro_model_path or s.data_dir / "models/kokoro/kokoro-v1.0.onnx")
        voices = Path(s.kokoro_voices_path or s.data_dir / "models/kokoro/voices-v1.0.bin")
        if not model.exists():
            await _download(KOKORO_MODEL_URL, model)
        if not voices.exists():
            await _download(KOKORO_VOICES_URL, voices)
        _kokoro = await asyncio.to_thread(Kokoro, str(model), str(voices))
        return _kokoro


async def kokoro_voices(cfg: dict) -> list[VoiceInfo]:
    k = await _get_kokoro()
    out = []
    for vid in sorted(k.get_voices()):
        lang, gender = _kokoro_meta(vid)
        out.append(VoiceInfo(vid, _pretty(vid), lang, gender))
    return out


async def kokoro_speak(cfg: dict, voice: VoiceRef, text: str) -> Speech:
    k = await _get_kokoro()
    lang, _ = _kokoro_meta(voice.provider_voice_id)
    samples, rate = await asyncio.to_thread(
        k.create, text, voice=voice.provider_voice_id, speed=1.0, lang=lang
    )
    return Speech(audio.float_to_pcm16(samples), rate)


# ---------------------------------------------------------------- piper
def _piper_dir() -> Path:
    s = get_settings()
    return Path(s.piper_voices_dir or s.data_dir / "models/piper")


async def piper_voices(cfg: dict) -> list[VoiceInfo]:
    out = []
    for f in sorted(_piper_dir().glob("*.onnx")):
        stem = f.stem  # en_US-lessac-medium
        parts = stem.split("-")
        lang = parts[0].replace("_", "-").lower() if parts else "en"
        name = parts[1].title() if len(parts) > 1 else stem
        out.append(VoiceInfo(stem, name, lang, "", stem))
    return out


async def piper_speak(cfg: dict, voice: VoiceRef, text: str) -> Speech:
    model = _piper_dir() / f"{voice.provider_voice_id}.onnx"
    if not model.exists():
        raise ProviderError(f"Piper voice not found: {model}")
    rate = 22050
    meta = model.with_suffix(".onnx.json")
    if meta.exists():
        import json

        rate = json.loads(meta.read_text()).get("audio", {}).get("sample_rate", rate)
    proc = await asyncio.create_subprocess_exec(
        get_settings().piper_binary,
        "--model",
        str(model),
        "--output_raw",
        stdin=asyncio.subprocess.PIPE,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    out, err = await proc.communicate(text.encode())
    if proc.returncode != 0:
        raise ProviderError(f"piper failed: {err.decode(errors='replace')[:200]}")
    return Speech(out, rate)


# ---------------------------------------------------------------- XTTS-v2 streaming server
def _xtts_base(cfg: dict) -> str:
    return (cfg.get("tts_base_url") or "http://127.0.0.1:8020").rstrip("/")


async def xtts_voices(cfg: dict) -> list[VoiceInfo]:
    async with client(timeout=15) as c:
        r = await c.get(f"{_xtts_base(cfg)}/studio_speakers")
        await raise_for(r, "XTTS")
        return [VoiceInfo(name, name, "en", "", "XTTS studio voice") for name in sorted(r.json())]


async def xtts_clone(cfg: dict, sample: bytes) -> dict[str, Any]:
    async with client(timeout=120) as c:
        r = await c.post(
            f"{_xtts_base(cfg)}/clone_speaker",
            files={"wav_file": ("sample.wav", sample, "audio/wav")},
        )
        await raise_for(r, "XTTS clone")
        return r.json()  # {"gpt_cond_latent": ..., "speaker_embedding": ...}


async def xtts_speak(cfg: dict, voice: VoiceRef, text: str) -> Speech:
    base = _xtts_base(cfg)
    async with client(timeout=180) as c:
        latents = voice.extra.get("latents")
        if not latents:
            r = await c.get(f"{base}/studio_speakers")
            await raise_for(r, "XTTS")
            latents = r.json().get(voice.provider_voice_id)
            if not latents:
                raise ProviderError(f"XTTS voice not found: {voice.provider_voice_id}")
        body = {"text": text, "language": voice.extra.get("language", "en"), **latents}
        r = await c.post(f"{base}/tts", json=body)
        await raise_for(r, "XTTS")
        wav = base64.b64decode(r.json() if isinstance(r.json(), str) else r.json()["audio"])
    pcm, rate, _ = audio.wav_to_pcm16(wav)
    return Speech(pcm, rate)


# ---------------------------------------------------------------- ElevenLabs
EL_BASE = "https://api.elevenlabs.io/v1"


async def elevenlabs_voices(cfg: dict) -> list[VoiceInfo]:
    async with client(timeout=20) as c:
        r = await c.get(f"{EL_BASE}/voices", headers={"xi-api-key": cfg.get("tts_api_key", "")})
        await raise_for(r, "ElevenLabs")
        out = []
        for v in r.json().get("voices", []):
            labels = v.get("labels") or {}
            out.append(
                VoiceInfo(
                    v["voice_id"],
                    v.get("name", v["voice_id"]),
                    labels.get("language", "en"),
                    labels.get("gender", ""),
                    labels.get("description", "") or labels.get("accent", ""),
                )
            )
        return out


async def elevenlabs_speak(cfg: dict, voice: VoiceRef, text: str) -> Speech:
    async with client(timeout=120) as c:
        r = await c.post(
            f"{EL_BASE}/text-to-speech/{voice.provider_voice_id}",
            params={"output_format": "pcm_24000"},
            headers={"xi-api-key": cfg.get("tts_api_key", "")},
            json={"text": text, "model_id": cfg.get("tts_model") or "eleven_flash_v2_5"},
        )
        await raise_for(r, "ElevenLabs")
        return Speech(r.content, 24000)


async def elevenlabs_clone(cfg: dict, sample: bytes, name: str) -> str:
    async with client(timeout=120) as c:
        r = await c.post(
            f"{EL_BASE}/voices/add",
            headers={"xi-api-key": cfg.get("tts_api_key", "")},
            data={"name": name, "description": "Cloned via Persona.AI"},
            files={"files": ("sample.wav", sample, "audio/wav")},
        )
        await raise_for(r, "ElevenLabs clone")
        return r.json()["voice_id"]


# ---------------------------------------------------------------- OpenAI-compatible
def _oa_base(cfg: dict) -> str:
    return (cfg.get("tts_base_url") or "https://api.openai.com/v1").rstrip("/")


def _oa_headers(cfg: dict) -> dict:
    return {"Authorization": f"Bearer {cfg['tts_api_key']}"} if cfg.get("tts_api_key") else {}


async def openai_voices(cfg: dict) -> list[VoiceInfo]:
    base = _oa_base(cfg)
    if "api.openai.com" not in base:
        # Kokoro-FastAPI exposes /v1/audio/voices
        try:
            async with client(timeout=10) as c:
                r = await c.get(f"{base}/audio/voices", headers=_oa_headers(cfg))
                if r.status_code == 200:
                    data = r.json()
                    ids = data.get("voices", data) if isinstance(data, dict) else data
                    out = []
                    for v in ids:
                        vid = v if isinstance(v, str) else v.get("id") or v.get("name")
                        lang, gender = _kokoro_meta(vid) if "_" in vid else ("en", "")
                        out.append(VoiceInfo(vid, _pretty(vid), lang, gender))
                    if out:
                        return out
        except Exception:  # noqa: BLE001
            log.info("voice listing not available at %s", base)
    return [VoiceInfo(v, v.title(), "en", "") for v in OPENAI_VOICES]


async def openai_speak(cfg: dict, voice: VoiceRef, text: str) -> Speech:
    base = _oa_base(cfg)
    model = cfg.get("tts_model") or ("gpt-4o-mini-tts" if "api.openai.com" in base else "kokoro")
    async with client(timeout=120) as c:
        r = await c.post(
            f"{base}/audio/speech",
            headers=_oa_headers(cfg),
            json={
                "model": model,
                "input": text,
                "voice": voice.provider_voice_id,
                "response_format": "pcm",
            },
        )
        await raise_for(r, "Speech API")
        data = r.content
    if data[:4] == b"RIFF":
        pcm, rate, _ = audio.wav_to_pcm16(data)
        return Speech(pcm, rate)
    return Speech(data, 24000)  # OpenAI "pcm" = 24 kHz 16-bit mono


# ---------------------------------------------------------------- mock
async def mock_voices(cfg: dict) -> list[VoiceInfo]:
    return [
        VoiceInfo("mock_low", "Low", "en", "male"),
        VoiceInfo("mock_high", "High", "en", "female"),
    ]


async def mock_speak(cfg: dict, voice: VoiceRef, text: str) -> Speech:
    rate = 16000
    freq = 180 if voice.provider_voice_id.endswith("low") else 320
    n = int(rate * min(4.0, 0.05 * max(1, len(text))))
    pcm = b"".join(
        struct.pack("<h", int(6000 * math.sin(2 * math.pi * freq * i / rate))) for i in range(n)
    )
    return Speech(pcm, rate)


PROVIDERS: dict[str, dict[str, Any]] = {
    "kokoro": {"voices": kokoro_voices, "speak": kokoro_speak, "clone": None},
    "piper": {"voices": piper_voices, "speak": piper_speak, "clone": None},
    "xtts": {"voices": xtts_voices, "speak": xtts_speak, "clone": "xtts"},
    "elevenlabs": {"voices": elevenlabs_voices, "speak": elevenlabs_speak, "clone": "elevenlabs"},
    "openai": {"voices": openai_voices, "speak": openai_speak, "clone": None},
    "mock": {"voices": mock_voices, "speak": mock_speak, "clone": "mock"},
}


def provider(cfg: dict) -> dict[str, Any] | None:
    return PROVIDERS.get(cfg.get("tts_provider") or "none")


def can_clone(cfg: dict) -> bool:
    p = provider(cfg)
    return bool(p and p["clone"])


async def list_voices(cfg: dict) -> list[VoiceInfo]:
    p = provider(cfg)
    if p is None:
        return []
    return await p["voices"](cfg)


async def speak(cfg: dict, voice: VoiceRef, text: str) -> Speech:
    p = provider(cfg)
    if p is None:
        raise ProviderError("Voices are turned off on this server")
    text = text.strip()
    if not text:
        return Speech(b"", 24000)
    return await p["speak"](cfg, voice, text[:4000])


async def status(cfg: dict[str, Any]) -> dict[str, Any]:
    name = cfg.get("tts_provider") or "none"
    if name == "none":
        return {"available": False, "detail": "off"}
    if name == "kokoro":
        try:
            import kokoro_onnx  # noqa: F401
        except ImportError:
            return {"available": False, "detail": "kokoro: kokoro-onnx not installed (tts extra)"}
        return {"available": True, "detail": "kokoro (in-process)"}
    if name == "piper":
        import shutil

        ok = shutil.which(get_settings().piper_binary) is not None
        n = len(list(_piper_dir().glob("*.onnx")))
        return {
            "available": ok and n > 0,
            "detail": f"piper: binary {'found' if ok else 'missing'}, {n} voices",
        }
    try:
        voices = await asyncio.wait_for(list_voices(cfg), timeout=8)
        return {"available": True, "detail": f"{name}: {len(voices)} voices"}
    except Exception as e:  # noqa: BLE001
        return {"available": False, "detail": f"{name}: {type(e).__name__}: {str(e)[:120]}"}
