from __future__ import annotations

from typing import Annotated

import jwt
from fastapi import Depends, HTTPException, Request, status
from sqlalchemy.ext.asyncio import AsyncSession

from persona.core.config import get_settings
from persona.core.ratelimit import enforce
from persona.db import get_db
from persona.models import User

DB = Annotated[AsyncSession, Depends(get_db)]


def _bearer(request: Request) -> str | None:
    auth = request.headers.get("authorization", "")
    if auth.lower().startswith("bearer "):
        return auth[7:].strip()
    return None


async def _user_from_token(db: AsyncSession, token: str | None) -> User | None:
    if not token:
        return None
    try:
        payload = jwt.decode(token, get_settings().secret_key, algorithms=["HS256"])
    except jwt.PyJWTError:
        return None
    if payload.get("typ") != "access":
        return None
    user = await db.get(User, payload.get("sub"))
    if user is None or not user.is_active:
        return None
    return user


async def current_user(request: Request, db: DB) -> User:
    user = await _user_from_token(db, _bearer(request))
    if user is None:
        raise HTTPException(
            status.HTTP_401_UNAUTHORIZED,
            "Not authenticated",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return user


async def optional_user(request: Request, db: DB) -> User | None:
    return await _user_from_token(db, _bearer(request))


async def admin_user(user: Annotated[User, Depends(current_user)]) -> User:
    if not user.is_admin:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Admin only")
    return user


CurrentUser = Annotated[User, Depends(current_user)]
OptionalUser = Annotated[User | None, Depends(optional_user)]
AdminUser = Annotated[User, Depends(admin_user)]


def user_rate_limit(bucket: str, per_min_attr: str):
    async def dep(user: CurrentUser) -> None:
        await enforce(f"{bucket}:u:{user.id}", getattr(get_settings(), per_min_attr))

    return Depends(dep)


chat_limit = user_rate_limit("chat", "rl_chat_per_min")
gen_limit = user_rate_limit("gen", "rl_gen_per_min")
