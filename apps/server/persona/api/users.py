from __future__ import annotations

from fastapi import APIRouter, File, HTTPException, UploadFile, status
from sqlalchemy import func, select

from persona.core.config import get_settings
from persona.core.deps import DB, CurrentUser, OptionalUser
from persona.core.security import hash_password, verify_password
from persona.models import Character, Media, Notification, PushToken, User
from persona.schemas import (
    CharacterCard,
    NotificationOut,
    PasswordChange,
    UserMe,
    UserPublic,
    UserUpdate,
)
from persona.services import storage

router = APIRouter(tags=["users"])

ALLOWED_PREFS = {"theme", "autoplay_voice", "default_persona_id", "reduce_motion", "language"}


@router.get("/me", response_model=UserMe)
async def me(user: CurrentUser) -> User:
    return user


@router.patch("/me", response_model=UserMe)
async def update_me(body: UserUpdate, user: CurrentUser, db: DB) -> User:
    if body.display_name is not None:
        user.display_name = body.display_name.strip() or user.username
    if body.bio is not None:
        user.bio = body.bio
    if body.avatar_url is not None:
        user.avatar_url = body.avatar_url or None
    if body.email is not None:
        email = body.email.strip().lower() or None
        if email and await db.scalar(
            select(User.id).where(User.email == email, User.id != user.id)
        ):
            raise HTTPException(status.HTTP_409_CONFLICT, "Email already registered")
        user.email = email
    if body.preferences is not None:
        prefs = dict(user.preferences or {})
        prefs.update({k: v for k, v in body.preferences.items() if k in ALLOWED_PREFS})
        user.preferences = prefs
    await db.commit()
    await db.refresh(user)
    return user


@router.post("/me/password", status_code=204)
async def change_password(body: PasswordChange, user: CurrentUser, db: DB) -> None:
    if not verify_password(user.password_hash, body.current_password):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Current password is wrong")
    user.password_hash = hash_password(body.new_password)
    await db.commit()


@router.post("/me/push-tokens", status_code=204)
async def register_push_token(body: dict, user: CurrentUser, db: DB) -> None:
    token = str(body.get("token", ""))[:255]
    if not token.startswith("ExponentPushToken[") and not token.startswith("ExpoPushToken["):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Expected an Expo push token")
    existing = await db.scalar(select(PushToken).where(PushToken.token == token))
    if existing:
        existing.user_id = user.id
    else:
        db.add(PushToken(user_id=user.id, token=token, platform=str(body.get("platform", ""))[:16]))
    await db.commit()


@router.get("/me/notifications", response_model=list[NotificationOut])
async def notifications(user: CurrentUser, db: DB) -> list[Notification]:
    rows = await db.scalars(
        select(Notification)
        .where(Notification.user_id == user.id)
        .order_by(Notification.created_at.desc())
        .limit(50)
    )
    return list(rows)


@router.post("/me/notifications/read", status_code=204)
async def mark_read(user: CurrentUser, db: DB) -> None:
    from datetime import UTC, datetime

    rows = await db.scalars(
        select(Notification).where(Notification.user_id == user.id, Notification.read_at.is_(None))
    )
    for n in rows:
        n.read_at = datetime.now(UTC)
    await db.commit()


@router.get("/users/{username}")
async def profile(username: str, db: DB, viewer: OptionalUser) -> dict:
    user = await db.scalar(select(User).where(func.lower(User.username) == username.lower()))
    if not user or not user.is_active:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "User not found")
    q = select(Character).where(Character.creator_id == user.id, Character.is_removed.is_(False))
    if not viewer or viewer.id != user.id:
        q = q.where(Character.visibility == "public")
    chars = (await db.scalars(q.order_by(Character.interaction_count.desc()).limit(100))).all()
    return {
        "user": UserPublic.model_validate(user).model_dump(),
        "characters": [CharacterCard.model_validate(c).model_dump() for c in chars],
        "total_interactions": sum(c.interaction_count for c in chars),
    }


@router.post("/media/images")
async def upload_image(user: CurrentUser, db: DB, file: UploadFile = File(...)) -> dict:
    data = await storage.read_limited(file, get_settings().max_image_mb * 1024 * 1024)
    rel, size = storage.save_image_bytes(data)
    db.add(Media(owner_id=user.id, kind="image", path=rel, mime="image/webp", size=size))
    await db.commit()
    return {"url": storage.media_url(rel)}
