from __future__ import annotations

from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy import func, select, update

from persona.core.config import get_settings
from persona.core.deps import DB, CurrentUser
from persona.core.ratelimit import limit_by_ip
from persona.core.security import (
    create_access_token,
    create_scoped_token,
    hash_password,
    hash_token,
    needs_rehash,
    new_refresh_token,
    verify_password,
)
from persona.models import Invite, RefreshToken, User, new_id
from persona.schemas import LoginIn, RefreshIn, RegisterIn, TokenOut, UserMe
from persona.services import settings_store

router = APIRouter(prefix="/auth", tags=["auth"])
auth_limit = Depends(limit_by_ip("auth", "rl_auth_per_min"))
REFRESH_COOKIE = "persona_refresh"
_DUMMY: list[str] = []


def _dummy_hash() -> str:
    if not _DUMMY:
        _DUMMY.append(hash_password(new_id()))
    return _DUMMY[0]


async def _issue(
    db: DB, user: User, request: Request, response: Response, family: str | None = None
) -> TokenOut:
    s = get_settings()
    raw, hashed = new_refresh_token()
    db.add(
        RefreshToken(
            user_id=user.id,
            token_hash=hashed,
            family=family or new_id(),
            expires_at=datetime.now(UTC) + timedelta(days=s.refresh_token_days),
            user_agent=(request.headers.get("user-agent") or "")[:255],
        )
    )
    await db.commit()
    response.set_cookie(
        REFRESH_COOKIE,
        raw,
        max_age=s.refresh_token_days * 86400,
        httponly=True,
        secure=s.public_url.startswith("https"),
        samesite="strict",
        path="/api/v1/auth",
    )
    return TokenOut(
        access_token=create_access_token(user.id, user.is_admin),
        refresh_token=raw,
        expires_in=s.access_token_minutes * 60,
        user=UserMe.model_validate(user),
    )


@router.post("/register", response_model=TokenOut, dependencies=[auth_limit])
async def register(body: RegisterIn, request: Request, response: Response, db: DB) -> TokenOut:
    cfg = await settings_store.load(db)
    user_count = await db.scalar(select(func.count(User.id))) or 0
    first_user = user_count == 0

    invite: Invite | None = None
    if not first_user:
        if not cfg["allow_registration"] and not cfg["invite_only"]:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Registration is closed")
        if cfg["invite_only"]:
            if not body.invite_code:
                raise HTTPException(status.HTTP_403_FORBIDDEN, "An invite code is required")
            invite = await db.get(Invite, body.invite_code.strip())
            now = datetime.now(UTC)
            if (
                invite is None
                or invite.uses >= invite.max_uses
                or (invite.expires_at and invite.expires_at < now)
            ):
                raise HTTPException(status.HTTP_403_FORBIDDEN, "Invalid or expired invite code")

    exists = await db.scalar(
        select(User.id).where(func.lower(User.username) == body.username.lower())
    )
    if exists:
        raise HTTPException(status.HTTP_409_CONFLICT, "Username already taken")
    if body.email and await db.scalar(select(User.id).where(User.email == body.email)):
        raise HTTPException(status.HTTP_409_CONFLICT, "Email already registered")

    user = User(
        username=body.username,
        email=body.email,
        password_hash=hash_password(body.password),
        display_name=body.username,
        is_admin=first_user,
        preferences={"theme": "dark", "autoplay_voice": False},
    )
    db.add(user)
    if invite:
        invite.uses += 1
    await db.flush()
    return await _issue(db, user, request, response)


@router.post("/login", response_model=TokenOut, dependencies=[auth_limit])
async def login(body: LoginIn, request: Request, response: Response, db: DB) -> TokenOut:
    user = await db.scalar(
        select(User).where(func.lower(User.username) == body.username.strip().lower())
    )
    # Always run a hash verification to keep timing similar for unknown users.
    ok = verify_password(user.password_hash if user else _dummy_hash(), body.password)
    if not user or not ok:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Wrong username or password")
    if not user.is_active:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Account disabled")
    if needs_rehash(user.password_hash):
        user.password_hash = hash_password(body.password)
    return await _issue(db, user, request, response)


@router.post("/refresh", response_model=TokenOut, dependencies=[auth_limit])
async def refresh(
    request: Request, response: Response, db: DB, body: RefreshIn | None = None
) -> TokenOut:
    raw = (body.refresh_token if body else None) or request.cookies.get(REFRESH_COOKIE)
    if not raw:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "No refresh token")
    token = await db.scalar(select(RefreshToken).where(RefreshToken.token_hash == hash_token(raw)))
    now = datetime.now(UTC)
    if token is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid refresh token")
    if token.revoked_at is not None:
        # Reuse of a rotated token: assume theft, revoke the whole family.
        await db.execute(
            update(RefreshToken)
            .where(RefreshToken.family == token.family, RefreshToken.revoked_at.is_(None))
            .values(revoked_at=now)
        )
        await db.commit()
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Refresh token reused; please log in")
    if token.expires_at < now:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Refresh token expired")
    user = await db.get(User, token.user_id)
    if not user or not user.is_active:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Account unavailable")
    token.revoked_at = now
    return await _issue(db, user, request, response, family=token.family)


@router.post("/logout", status_code=204)
async def logout(
    request: Request, response: Response, db: DB, body: RefreshIn | None = None
) -> Response:
    raw = (body.refresh_token if body else None) or request.cookies.get(REFRESH_COOKIE)
    if raw:
        token = await db.scalar(
            select(RefreshToken).where(RefreshToken.token_hash == hash_token(raw))
        )
        if token and token.revoked_at is None:
            token.revoked_at = datetime.now(UTC)
            await db.commit()
    response.delete_cookie(REFRESH_COOKIE, path="/api/v1/auth")
    response.status_code = 204
    return response


@router.post("/ws-token")
async def ws_token(user: CurrentUser) -> dict:
    """Short-lived token for WebSocket connections (browsers can't set WS headers)."""
    return {"token": create_scoped_token(user.id, "ws", minutes=2)}


@router.get("/config")
async def auth_config(db: DB) -> dict:
    """Public instance info used by login/register screens and mobile server validation."""
    cfg = await settings_store.load(db)
    has_users = bool(await db.scalar(select(func.count(User.id))))
    return {
        "app": "persona",
        "instance_name": cfg["instance_name"],
        "invite_only": cfg["invite_only"],
        "registration_open": cfg["allow_registration"] or cfg["invite_only"] or not has_users,
        "needs_setup": not has_users,
        "version": __import__("persona").__version__,
    }
