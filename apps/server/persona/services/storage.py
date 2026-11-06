"""Local media storage with strict validation. Files get unguessable names under DATA_DIR/media."""

from __future__ import annotations

import io
from pathlib import Path

from fastapi import HTTPException, UploadFile, status
from PIL import Image, ImageOps

from persona.core.config import get_settings
from persona.models import new_id

Image.MAX_IMAGE_PIXELS = 40_000_000  # decompression-bomb guard

IMAGE_MAGIC = {
    b"\x89PNG\r\n\x1a\n": "png",
    b"\xff\xd8\xff": "jpeg",
    b"RIFF": "webp",  # verified further below
}

AUDIO_TYPES = {
    "wav": ("audio/wav", lambda b: b[:4] == b"RIFF" and b[8:12] == b"WAVE"),
    "mp3": ("audio/mpeg", lambda b: b[:3] == b"ID3" or (b[0] == 0xFF and (b[1] & 0xE0) == 0xE0)),
    "ogg": ("audio/ogg", lambda b: b[:4] == b"OggS"),
    "webm": ("audio/webm", lambda b: b[:4] == b"\x1a\x45\xdf\xa3"),
    "m4a": ("audio/mp4", lambda b: b[4:8] == b"ftyp"),
    "flac": ("audio/flac", lambda b: b[:4] == b"fLaC"),
}


def media_root() -> Path:
    root = get_settings().media_dir
    root.mkdir(parents=True, exist_ok=True)
    return root


def media_url(rel: str) -> str:
    return f"/media/{rel}"


def path_for_url(url: str) -> Path | None:
    if not url or not url.startswith("/media/"):
        return None
    rel = url[len("/media/") :]
    p = (media_root() / rel).resolve()
    if media_root().resolve() not in p.parents:
        return None
    return p


async def read_limited(upload: UploadFile, max_bytes: int) -> bytes:
    data = await upload.read(max_bytes + 1)
    if len(data) > max_bytes:
        raise HTTPException(
            status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            f"File too large (max {max_bytes // (1024 * 1024)} MB)",
        )
    if not data:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Empty file")
    return data


def sniff_image(data: bytes) -> str | None:
    for magic, kind in IMAGE_MAGIC.items():
        if data.startswith(magic):
            if kind == "webp" and data[8:12] != b"WEBP":
                return None
            return kind
    return None


def save_image_bytes(
    data: bytes, *, subdir: str = "images", max_side: int = 1024
) -> tuple[str, int]:
    """Validate + re-encode an image as WebP (strips metadata, kills polyglots)."""
    if sniff_image(data) is None:
        raise HTTPException(status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, "Only PNG, JPEG or WebP images")
    try:
        img = Image.open(io.BytesIO(data))
        img.verify()
        img = Image.open(io.BytesIO(data))
        img = ImageOps.exif_transpose(img)
        if img.mode not in ("RGB", "RGBA"):
            img = img.convert("RGBA" if "A" in img.getbands() else "RGB")
        img.thumbnail((max_side, max_side))
    except HTTPException:
        raise
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Could not read image") from e
    out = io.BytesIO()
    img.save(out, "WEBP", quality=88, method=4)
    rel = f"{subdir}/{new_id()}.webp"
    dest = media_root() / rel
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_bytes(out.getvalue())
    return rel, out.tell()


def sniff_audio(data: bytes) -> tuple[str, str] | None:
    if len(data) < 12:
        return None
    for ext, (mime, check) in AUDIO_TYPES.items():
        try:
            if check(data):
                return ext, mime
        except IndexError:
            continue
    return None


def save_audio_bytes(data: bytes, *, subdir: str = "audio") -> tuple[str, str, int]:
    kind = sniff_audio(data)
    if kind is None:
        raise HTTPException(
            status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            "Unsupported audio (wav, mp3, ogg, webm, m4a, flac)",
        )
    ext, mime = kind
    rel = f"{subdir}/{new_id()}.{ext}"
    dest = media_root() / rel
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_bytes(data)
    return rel, mime, len(data)


def save_generated(data: bytes, ext: str, subdir: str) -> str:
    rel = f"{subdir}/{new_id()}.{ext}"
    dest = media_root() / rel
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_bytes(data)
    return rel
