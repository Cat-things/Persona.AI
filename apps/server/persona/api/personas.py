"""Personas: who the user is in a chat (name + description the character sees)."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, status
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from persona.core.deps import DB, CurrentUser
from persona.models import Persona, User
from persona.schemas import PersonaIn, PersonaOut, PersonaUpdate

router = APIRouter(prefix="/personas", tags=["personas"])

MAX_PERSONAS = 50


def _check_avatar(url: str | None) -> None:
    # Only our own media: no hot-linking (tracking pixels) from arbitrary hosts.
    if url and not url.startswith("/media/"):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Avatar must be an uploaded image")


async def _owned(db: AsyncSession, persona_id: str, user: User) -> Persona:
    p = await db.get(Persona, persona_id)
    if p is None or p.user_id != user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Persona not found")
    return p


async def _make_default(db: AsyncSession, user: User, p: Persona | None) -> None:
    """Exactly zero or one default persona per user, mirrored into preferences."""
    await db.execute(
        update(Persona)
        .where(Persona.user_id == user.id, Persona.id != (p.id if p else ""))
        .values(is_default=False)
    )
    prefs = dict(user.preferences or {})
    if p:
        p.is_default = True
        prefs["default_persona_id"] = p.id
    else:
        prefs.pop("default_persona_id", None)
    user.preferences = prefs


@router.get("", response_model=list[PersonaOut])
async def list_personas(db: DB, user: CurrentUser) -> list[Persona]:
    rows = await db.scalars(
        select(Persona).where(Persona.user_id == user.id).order_by(Persona.created_at)
    )
    return list(rows)


@router.post("", response_model=PersonaOut, status_code=201)
async def create_persona(body: PersonaIn, db: DB, user: CurrentUser) -> Persona:
    _check_avatar(body.avatar_url)
    n = await db.scalar(select(func.count()).where(Persona.user_id == user.id))
    if (n or 0) >= MAX_PERSONAS:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"At most {MAX_PERSONAS} personas")
    p = Persona(user_id=user.id, **body.model_dump(exclude={"is_default"}))
    db.add(p)
    await db.flush()
    if body.is_default:
        await _make_default(db, user, p)
    await db.commit()
    await db.refresh(p)
    return p


@router.patch("/{persona_id}", response_model=PersonaOut)
async def update_persona(
    persona_id: str, body: PersonaUpdate, db: DB, user: CurrentUser
) -> Persona:
    p = await _owned(db, persona_id, user)
    changes = body.model_dump(exclude_unset=True)
    if "avatar_url" in changes:
        _check_avatar(changes["avatar_url"])
    default = changes.pop("is_default", None)
    for k, v in changes.items():
        setattr(p, k, v)
    if default is True:
        await _make_default(db, user, p)
    elif default is False and p.is_default:
        p.is_default = False
        await _make_default(db, user, None)
    await db.commit()
    await db.refresh(p)
    return p


@router.delete("/{persona_id}", status_code=204)
async def delete_persona(persona_id: str, db: DB, user: CurrentUser) -> None:
    p = await _owned(db, persona_id, user)
    if p.is_default or (user.preferences or {}).get("default_persona_id") == p.id:
        await _make_default(db, user, None)
    await db.delete(p)  # chats keep working: persona_id is SET NULL
    await db.commit()
