"""Character Card import/export (SillyTavern / TavernAI cards, V1, V2 and V3 data).

Export: JSON (`chara_card_v2`) or a PNG with the card in a base64 `chara` tEXt chunk.
Import: the same JSON or PNG. Fields Persona.AI has no column for (system_prompt,
alternate_greetings, character_book, ...) are kept in `extensions["_card"]` so a
round trip loses nothing; the card's own `extensions` are kept as-is.
"""

from __future__ import annotations

import base64
import binascii
import io
import json
import re
from typing import Any

from fastapi import APIRouter, File, HTTPException, UploadFile, status
from fastapi.responses import JSONResponse, Response
from PIL import Image, PngImagePlugin

from persona.api.characters import _filter_public, can_edit, get_visible, tags_text, to_out
from persona.core.config import get_settings
from persona.core.deps import DB, CurrentUser
from persona.models import Character
from persona.schemas import CharacterOut
from persona.services import storage

router = APIRouter(prefix="/characters", tags=["cards"])

# Cards with big lorebooks exceed Pillow's 1 MB text-chunk default; stay bounded anyway.
PngImagePlugin.MAX_TEXT_CHUNK = 4 * 1024 * 1024
PngImagePlugin.MAX_TEXT_MEMORY = 8 * 1024 * 1024

LIMITS = {
    "name": 64,
    "tagline": 140,
    "description": 20_000,
    "greeting": 10_000,
    "definition": 32_000,
    "personality": 10_000,
    "scenario": 10_000,
    "creator_credit": 128,
}
EXTRA_FIELDS = (
    "creator_notes",
    "system_prompt",
    "post_history_instructions",
    "alternate_greetings",
    "character_book",
    "character_version",
    "group_only_greetings",
    "nickname",
)
MAX_JSON = 2 * 1024 * 1024


def _s(v: Any, limit: int) -> str:
    return str(v or "").replace("\r\n", "\n").strip()[:limit]


def _safe_filename(name: str) -> str:
    return re.sub(r"[^A-Za-z0-9._-]+", "_", name).strip("_")[:60] or "character"


# ---------- export ----------
def card_dict(c: Character) -> dict[str, Any]:
    ext = dict(c.extensions or {})
    extra = ext.pop("_card", {}) if isinstance(ext.get("_card"), dict) else {}
    ext.pop("_card", None)
    ext["persona_ai"] = {"tagline": c.tagline}
    data: dict[str, Any] = {
        "name": c.name,
        "description": c.description,
        "personality": c.personality,
        "scenario": c.scenario,
        "first_mes": c.greeting,
        "mes_example": c.definition,
        "creator_notes": extra.get("creator_notes") or c.tagline,
        "system_prompt": extra.get("system_prompt", ""),
        "post_history_instructions": extra.get("post_history_instructions", ""),
        "alternate_greetings": extra.get("alternate_greetings", []),
        "tags": list(c.tags or []),
        "creator": c.creator_credit,
        "character_version": extra.get("character_version", ""),
        "extensions": ext,
    }
    if extra.get("character_book"):
        data["character_book"] = extra["character_book"]
    return {"spec": "chara_card_v2", "spec_version": "2.0", "data": data}


async def _exportable(db, character_id: str, user) -> Character:
    c = await get_visible(db, character_id, user)
    # The definition is private to the creator, so only they (or an admin) can export.
    if not can_edit(c, user):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only the creator can export this character")
    return c


@router.get("/{character_id}/card")
async def export_json(character_id: str, db: DB, user: CurrentUser) -> JSONResponse:
    c = await _exportable(db, character_id, user)
    return JSONResponse(
        card_dict(c),
        headers={"Content-Disposition": f'attachment; filename="{_safe_filename(c.name)}.json"'},
    )


def _avatar_image(c: Character) -> Image.Image:
    path = storage.path_for_url(c.avatar_url or "")
    if path and path.is_file():
        try:
            img = Image.open(path)
            img.load()
            return img.convert("RGBA")
        except Exception:  # noqa: BLE001
            pass
    return Image.new("RGBA", (400, 600), (38, 36, 60, 255))


@router.get("/{character_id}/card.png")
async def export_png(character_id: str, db: DB, user: CurrentUser) -> Response:
    c = await _exportable(db, character_id, user)
    img = _avatar_image(c)
    info = PngImagePlugin.PngInfo()
    payload = json.dumps(card_dict(c), ensure_ascii=False).encode()
    info.add_text("chara", base64.b64encode(payload).decode("ascii"))
    out = io.BytesIO()
    img.save(out, "PNG", pnginfo=info)
    return Response(
        out.getvalue(),
        media_type="image/png",
        headers={"Content-Disposition": f'attachment; filename="{_safe_filename(c.name)}.png"'},
    )


# ---------- import ----------
def _decode_chunk(raw: str) -> dict[str, Any]:
    try:
        return json.loads(base64.b64decode(raw, validate=False))
    except (binascii.Error, ValueError):
        try:
            return json.loads(raw)
        except ValueError as e:
            raise HTTPException(400, "The card data in this PNG is unreadable") from e


def parse_png(data: bytes) -> tuple[dict[str, Any], bytes]:
    try:
        img = Image.open(io.BytesIO(data))
        img.load()
    except Exception as e:  # noqa: BLE001
        raise HTTPException(400, "Could not read PNG") from e
    text = getattr(img, "text", {}) or {}
    raw = text.get("ccv3") or text.get("chara")
    if not raw:
        raise HTTPException(400, "This PNG has no character card data")
    return _decode_chunk(raw), data


def normalize(card: Any) -> dict[str, Any]:
    """Return our Character fields from a V1/V2/V3 card."""
    if not isinstance(card, dict):
        raise HTTPException(400, "Not a character card")
    spec = card.get("spec")
    data = card.get("data") if spec in ("chara_card_v2", "chara_card_v3") else card
    if not isinstance(data, dict) or not str(data.get("name") or "").strip():
        raise HTTPException(400, "Not a character card (missing name)")
    ext = data.get("extensions") if isinstance(data.get("extensions"), dict) else {}
    ext = dict(ext)
    ours = ext.pop("persona_ai", {}) if isinstance(ext.get("persona_ai"), dict) else {}
    extra = {k: data[k] for k in EXTRA_FIELDS if data.get(k)}
    if extra:
        ext["_card"] = extra
    notes = _s(data.get("creator_notes") or data.get("creatorcomment"), 2000)
    tagline = _s(ours.get("tagline"), 140) or notes.split("\n", 1)[0][:140]
    tags = data.get("tags") if isinstance(data.get("tags"), list) else []
    clean_tags: list[str] = []
    for t in tags[:20]:
        t = str(t).strip().lower()[:32]
        if t and t not in clean_tags:
            clean_tags.append(t)
    fields = {
        "name": _s(data.get("name"), LIMITS["name"]),
        "tagline": tagline,
        "description": _s(data.get("description"), LIMITS["description"]),
        "personality": _s(data.get("personality"), LIMITS["personality"]),
        "scenario": _s(data.get("scenario"), LIMITS["scenario"]),
        "greeting": _s(data.get("first_mes"), LIMITS["greeting"]),
        "definition": _s(data.get("mes_example"), LIMITS["definition"]),
        "creator_credit": _s(data.get("creator"), LIMITS["creator_credit"]),
        "tags": clean_tags,
        "extensions": ext,
    }
    if len(json.dumps(ext)) > MAX_JSON:
        raise HTTPException(413, "Card extensions are too large")
    return fields


@router.post("/import", response_model=CharacterOut, status_code=201)
async def import_card(db: DB, user: CurrentUser, file: UploadFile = File(...)) -> CharacterOut:
    raw = await storage.read_limited(file, get_settings().max_image_mb * 1024 * 1024)
    avatar: bytes | None = None
    if raw.startswith(b"\x89PNG\r\n\x1a\n"):
        card, avatar = parse_png(raw)
    else:
        if len(raw) > MAX_JSON:
            raise HTTPException(413, "Card JSON is too large")
        try:
            card = json.loads(raw.decode("utf-8-sig"))
        except (UnicodeDecodeError, ValueError) as e:
            raise HTTPException(400, "Upload a card as .json or .png") from e
    fields = normalize(card)
    # Imports start private so the owner can review them before publishing.
    await _filter_public(db, fields, "private")
    c = Character(
        **fields,
        creator_id=user.id,
        visibility="private",
        tags_text=tags_text(fields["tags"]),
    )
    if not c.creator_credit:
        c.creator_credit = user.username
    if avatar:
        try:
            rel, _ = storage.save_image_bytes(avatar, subdir="avatars", max_side=768)
            c.avatar_url = storage.media_url(rel)
        except HTTPException:
            pass  # card data is fine even if the picture isn't
    db.add(c)
    await db.commit()
    await db.refresh(c)
    return to_out(c, user)
