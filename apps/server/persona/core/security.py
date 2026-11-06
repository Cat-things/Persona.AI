from __future__ import annotations

import hashlib
import secrets
from datetime import UTC, datetime, timedelta

import jwt
from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError, VerifyMismatchError

from persona.core.config import get_settings

_ph = PasswordHasher()  # argon2id defaults
ALGO = "HS256"


def hash_password(password: str) -> str:
    return _ph.hash(password)


def verify_password(password_hash: str, password: str) -> bool:
    try:
        return _ph.verify(password_hash, password)
    except (VerifyMismatchError, VerificationError, InvalidHashError):
        return False


def needs_rehash(password_hash: str) -> bool:
    return _ph.check_needs_rehash(password_hash)


def create_access_token(user_id: str, is_admin: bool, *, minutes: int | None = None) -> str:
    s = get_settings()
    now = datetime.now(UTC)
    payload = {
        "sub": user_id,
        "adm": is_admin,
        "typ": "access",
        "iat": now,
        "exp": now + timedelta(minutes=minutes or s.access_token_minutes),
    }
    return jwt.encode(payload, s.secret_key, algorithm=ALGO)


def create_scoped_token(user_id: str, scope: str, *, minutes: int = 5) -> str:
    """Short-lived token for things like WebSocket auth or signed media links."""
    s = get_settings()
    now = datetime.now(UTC)
    payload = {"sub": user_id, "typ": scope, "iat": now, "exp": now + timedelta(minutes=minutes)}
    return jwt.encode(payload, s.secret_key, algorithm=ALGO)


def decode_token(token: str, expected_type: str = "access") -> dict:
    payload = jwt.decode(token, get_settings().secret_key, algorithms=[ALGO])
    if payload.get("typ") != expected_type:
        raise jwt.InvalidTokenError("wrong token type")
    return payload


def new_refresh_token() -> tuple[str, str]:
    raw = secrets.token_urlsafe(48)
    return raw, hash_token(raw)


def hash_token(raw: str) -> str:
    return hashlib.sha256(raw.encode()).hexdigest()


def random_secret(nbytes: int = 32) -> str:
    return secrets.token_urlsafe(nbytes)
