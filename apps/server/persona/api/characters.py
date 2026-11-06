from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Literal

from fastapi import APIRouter, HTTPException, Query, status
from sqlalchemy import and_, delete, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from persona.core.deps import DB, CurrentUser
from persona.models import Character, CharacterLike, Chat, User, Voice
from persona.schemas import (
    CharacterCard,
    CharacterCreate,
    CharacterOut,
    CharacterUpdate,
    Page,
)
from persona.services import content_filter, settings_store

router = APIRouter(prefix="/characters", tags=["characters"])


def tags_text(tags: list[str]) -> str:
    return "|" + "|".join(tags) + "|" if tags else ""


def can_view(c: Character, user: User | None) -> bool:
    if c.is_removed:
        return bool(user and user.is_admin)
    if c.visibility in ("public", "unlisted"):
        return True
    return bool(user and (user.id == c.creator_id or user.is_admin))


def can_edit(c: Character, user: User) -> bool:
    return user.is_admin or c.creator_id == user.id


def to_out(c: Character, user: User | None, liked: bool = False) -> CharacterOut:
    out = CharacterOut.model_validate(c)
    owner = bool(user and (user.id == c.creator_id or user.is_admin))
    out.is_owner = bool(user and user.id == c.creator_id)
    out.liked = liked
    if not owner:
        out.definition = None
        out.personality = None
        out.scenario = None
        out.llm_model = None
        out.llm_params = {}
    return out


async def get_visible(db: AsyncSession, character_id: str, user: User | None) -> Character:
    c = await db.get(Character, character_id)
    if c is None or not can_view(c, user):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Character not found")
    return c


async def _check_voice(db: AsyncSession, voice_id: str | None, user: User) -> None:
    if not voice_id:
        return
    v = await db.get(Voice, voice_id)
    if v is None or not (v.is_public or v.owner_id == user.id):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Unknown voice")


async def _filter_public(db: AsyncSession, data: dict, visibility: str) -> None:
    """Public listings must pass the instance filter (always-on rules apply to everything)."""
    cfg = await settings_store.load(db)
    if visibility != "public":
        cfg = {**cfg, "content_filter": False}
    text = "\n".join(
        str(data.get(k) or "")
        for k in ("name", "tagline", "description", "greeting", "definition", "scenario")
    )
    res = content_filter.check(text, cfg)
    if res.blocked:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            f"Character content is not allowed on this instance ({res.category}).",
        )


@router.get("", response_model=Page[CharacterCard])
async def discover(
    db: DB,
    user: CurrentUser,
    sort: Literal["trending", "popular", "recent", "featured"] = "popular",
    q: str | None = Query(default=None, max_length=100),
    tag: str | None = Query(default=None, max_length=32),
    cursor: int = Query(default=0, ge=0),
    limit: int = Query(default=24, ge=1, le=60),
) -> Page[CharacterCard]:
    base = select(Character).where(
        Character.visibility == "public", Character.is_removed.is_(False)
    )
    if q:
        like = f"%{q.strip().lower()}%"
        base = base.where(
            or_(
                func.lower(Character.name).like(like),
                func.lower(Character.tagline).like(like),
                Character.tags_text.like(f"%|{q.strip().lower()}%"),
            )
        )
    if tag:
        base = base.where(Character.tags_text.like(f"%|{tag.strip().lower()}|%"))

    if sort == "featured":
        cfg = await settings_store.load(db)
        ids = cfg.get("featured_character_ids") or []
        base = base.where(or_(Character.featured.is_(True), Character.id.in_(ids)))
        stmt = base.order_by(Character.interaction_count.desc())
    elif sort == "recent":
        stmt = base.order_by(Character.created_at.desc())
    elif sort == "trending":
        since = datetime.now(UTC) - timedelta(days=7)
        recent = (
            select(Chat.character_id, func.count(Chat.id).label("n"))
            .where(Chat.created_at >= since, Chat.character_id.is_not(None))
            .group_by(Chat.character_id)
            .subquery()
        )
        stmt = base.outerjoin(recent, recent.c.character_id == Character.id).order_by(
            func.coalesce(recent.c.n, 0).desc(), Character.interaction_count.desc()
        )
    else:
        stmt = base.order_by(Character.interaction_count.desc(), Character.created_at.desc())

    rows = (await db.scalars(stmt.offset(cursor).limit(limit + 1))).unique().all()
    items = [CharacterCard.model_validate(c) for c in rows[:limit]]
    return Page(items=items, next_cursor=str(cursor + limit) if len(rows) > limit else None)


@router.get("/tags")
async def popular_tags(db: DB, user: CurrentUser) -> list[dict]:
    rows = await db.scalars(
        select(Character.tags)
        .where(Character.visibility == "public", Character.is_removed.is_(False))
        .order_by(Character.interaction_count.desc())
        .limit(500)
    )
    counts: dict[str, int] = {}
    for tags in rows:
        for t in tags or []:
            counts[t] = counts.get(t, 0) + 1
    return [{"tag": t, "count": n} for t, n in sorted(counts.items(), key=lambda x: -x[1])[:30]]


@router.get("/mine", response_model=list[CharacterCard])
async def mine(db: DB, user: CurrentUser) -> list[Character]:
    rows = await db.scalars(
        select(Character)
        .where(Character.creator_id == user.id, Character.is_removed.is_(False))
        .order_by(Character.updated_at.desc())
    )
    return list(rows.unique())


@router.get("/liked", response_model=list[CharacterCard])
async def liked(db: DB, user: CurrentUser) -> list[Character]:
    rows = await db.scalars(
        select(Character)
        .join(
            CharacterLike,
            and_(CharacterLike.character_id == Character.id, CharacterLike.user_id == user.id),
        )
        .where(Character.is_removed.is_(False))
        .order_by(CharacterLike.created_at.desc())
    )
    return [c for c in rows.unique() if can_view(c, user)]


@router.post("", response_model=CharacterOut, status_code=201)
async def create(body: CharacterCreate, db: DB, user: CurrentUser) -> CharacterOut:
    await _check_voice(db, body.voice_id, user)
    await _filter_public(db, body.model_dump(), body.visibility)
    c = Character(**body.model_dump(), creator_id=user.id, tags_text=tags_text(body.tags))
    if not c.creator_credit:
        c.creator_credit = user.username
    db.add(c)
    await db.commit()
    await db.refresh(c)
    return to_out(c, user)


@router.get("/{character_id}", response_model=CharacterOut)
async def get_one(character_id: str, db: DB, user: CurrentUser) -> CharacterOut:
    c = await get_visible(db, character_id, user)
    liked_row = await db.get(CharacterLike, (user.id, c.id))
    return to_out(c, user, liked=liked_row is not None)


@router.patch("/{character_id}", response_model=CharacterOut)
async def update(
    character_id: str, body: CharacterUpdate, db: DB, user: CurrentUser
) -> CharacterOut:
    c = await get_visible(db, character_id, user)
    if not can_edit(c, user):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only the creator can edit this character")
    changes = body.model_dump(exclude_unset=True)
    if "voice_id" in changes:
        await _check_voice(db, changes["voice_id"], user)
    merged = {
        k: getattr(c, k)
        for k in ("name", "tagline", "description", "greeting", "definition", "scenario")
    } | changes
    await _filter_public(db, merged, changes.get("visibility", c.visibility))
    for k, v in changes.items():
        setattr(c, k, v)
    if "tags" in changes:
        c.tags_text = tags_text(c.tags)
    await db.commit()
    await db.refresh(c)
    return to_out(c, user)


@router.delete("/{character_id}", status_code=204)
async def remove(character_id: str, db: DB, user: CurrentUser) -> None:
    c = await get_visible(db, character_id, user)
    if not can_edit(c, user):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only the creator can delete this character")
    await db.delete(c)
    await db.commit()


@router.post("/{character_id}/like", response_model=CharacterOut)
async def like(character_id: str, db: DB, user: CurrentUser) -> CharacterOut:
    c = await get_visible(db, character_id, user)
    if await db.get(CharacterLike, (user.id, c.id)) is None:
        db.add(CharacterLike(user_id=user.id, character_id=c.id))
        c.like_count += 1
        await db.commit()
    return to_out(c, user, liked=True)


@router.delete("/{character_id}/like", response_model=CharacterOut)
async def unlike(character_id: str, db: DB, user: CurrentUser) -> CharacterOut:
    c = await get_visible(db, character_id, user)
    res = await db.execute(
        delete(CharacterLike).where(
            CharacterLike.user_id == user.id, CharacterLike.character_id == c.id
        )
    )
    if res.rowcount:
        c.like_count = max(0, c.like_count - 1)
    await db.commit()
    return to_out(c, user, liked=False)
