"""Audio helpers: WAV packing, ffmpeg conversion, text cleanup for speech."""

from __future__ import annotations

import asyncio
import io
import re
import shutil
import struct
import wave

import numpy as np


def pcm16_to_wav(pcm: bytes, rate: int, channels: int = 1) -> bytes:
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(channels)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(pcm)
    return buf.getvalue()


def float_to_pcm16(samples: np.ndarray) -> bytes:
    s = np.clip(np.asarray(samples, dtype=np.float32), -1.0, 1.0)
    return (s * 32767.0).astype("<i2").tobytes()


def wav_to_pcm16(data: bytes) -> tuple[bytes, int, int]:
    with wave.open(io.BytesIO(data), "rb") as w:
        if w.getsampwidth() != 2:
            raise ValueError("Only 16-bit WAV is supported without ffmpeg")
        return w.readframes(w.getnframes()), w.getframerate(), w.getnchannels()


def resample_pcm16(pcm: bytes, src_rate: int, dst_rate: int) -> bytes:
    if src_rate == dst_rate or not pcm:
        return pcm
    x = np.frombuffer(pcm, dtype="<i2").astype(np.float32)
    n = int(len(x) * dst_rate / src_rate)
    if n <= 0:
        return b""
    y = np.interp(np.linspace(0, len(x) - 1, n), np.arange(len(x)), x)
    return y.astype("<i2").tobytes()


def has_ffmpeg() -> bool:
    return shutil.which("ffmpeg") is not None


async def ffmpeg(data: bytes, out_args: list[str], in_args: list[str] | None = None) -> bytes:
    proc = await asyncio.create_subprocess_exec(
        "ffmpeg",
        "-hide_banner",
        "-loglevel",
        "error",
        *(in_args or []),
        "-i",
        "pipe:0",
        *out_args,
        "pipe:1",
        stdin=asyncio.subprocess.PIPE,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    out, err = await proc.communicate(data)
    if proc.returncode != 0:
        raise RuntimeError(f"ffmpeg failed: {err.decode(errors='replace')[:300]}")
    return out


async def to_mp3(wav: bytes) -> tuple[bytes, str]:
    """Compress for playback when ffmpeg is available; otherwise keep WAV."""
    if not has_ffmpeg():
        return wav, "audio/wav"
    return await ffmpeg(wav, ["-f", "mp3", "-b:a", "64k", "-ac", "1"]), "audio/mpeg"


async def decode_to_pcm16(data: bytes, rate: int = 16000) -> bytes:
    """Any container/codec -> mono PCM16 at `rate` (needs ffmpeg unless already WAV)."""
    if data[:4] == b"RIFF" and data[8:12] == b"WAVE":
        try:
            pcm, src, ch = wav_to_pcm16(data)
            if ch > 1:
                a = np.frombuffer(pcm, dtype="<i2").reshape(-1, ch).mean(axis=1)
                pcm = a.astype("<i2").tobytes()
            return resample_pcm16(pcm, src, rate)
        except (ValueError, wave.Error):
            pass
    if not has_ffmpeg():
        raise RuntimeError("ffmpeg is required to decode this audio format")
    return await ffmpeg(data, ["-f", "s16le", "-ac", "1", "-ar", str(rate)])


_ACTION = re.compile(r"\*[^*\n]+\*")
_URL = re.compile(r"https?://\S+")


def speakable(text: str) -> str:
    """Drop roleplay *actions*, URLs and markup so TTS reads only dialogue."""
    t = _ACTION.sub(" ", text)
    t = _URL.sub(" link ", t)
    t = re.sub(r"[`_#>|~]", "", t)
    t = re.sub(r"\s+", " ", t).strip()
    return t


_SENT = re.compile(r"(.+?[.!?…]+[\"')\]]*)(\s+|$)", re.S)


def split_sentences(buffer: str) -> tuple[list[str], str]:
    """Return complete sentences and the unfinished remainder (for streaming TTS)."""
    out: list[str] = []
    pos = 0
    for m in _SENT.finditer(buffer):
        if m.end(2) == len(buffer) and not m.group(2):
            break  # might still be growing ("Mr." / "3.5")
        s = m.group(1).strip()
        if s:
            out.append(s)
        pos = m.end()
    rest = buffer[pos:]
    # Long run without punctuation: cut at a comma or space so speech can start.
    if len(rest) > 220:
        cut = max(rest.rfind(", ", 0, 200), rest.rfind(" ", 0, 200))
        if cut > 40:
            out.append(rest[: cut + 1].strip())
            rest = rest[cut + 1 :]
    return out, rest


def silence_pcm16(ms: int, rate: int) -> bytes:
    return struct.pack("<h", 0) * int(rate * ms / 1000)
