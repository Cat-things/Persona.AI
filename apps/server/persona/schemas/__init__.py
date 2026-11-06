"""Pydantic API schemas. Mirrored by hand in packages/shared/src/types.ts."""

from __future__ import annotations

import re
from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

USERNAME_RE = re.compile(r"^[a-zA-Z0-9_]{3,32}$")
Visibility = Literal["public", "unlisted", "private"]


class ORM(BaseModel):
    model_config = ConfigDict(from_attributes=True)


# ---------- auth ----------
class RegisterIn(BaseModel):
    username: str
    password: str = Field(min_length=8, max_length=256)
    email: str | None = None
    invite_code: str | None = None

    @field_validator("username")
    @classmethod
    def _username(cls, v: str) -> str:
        if not USERNAME_RE.match(v):
            raise ValueError("Username must be 3-32 letters, digits or underscores")
        return v

    @field_validator("email")
    @classmethod
    def _email(cls, v: str | None) -> str | None:
        if v in (None, ""):
            return None
        if not re.match(r"^[^@\s]+@[^@\s]+\.[^@\s]+$", v):
            raise ValueError("Invalid email")
        return v.lower()


class LoginIn(BaseModel):
    username: str
    password: str


class RefreshIn(BaseModel):
    refresh_token: str | None = None


class TokenOut(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    expires_in: int
    user: UserMe


# ---------- users ----------
class UserPublic(ORM):
    id: str
    username: str
    display_name: str
    avatar_url: str | None
    bio: str


class UserMe(UserPublic):
    email: str | None
    is_admin: bool
    is_active: bool
    preferences: dict[str, Any]
    created_at: datetime


class UserUpdate(BaseModel):
    display_name: str | None = Field(default=None, max_length=64)
    bio: str | None = Field(default=None, max_length=2000)
    avatar_url: str | None = None
    email: str | None = None
    preferences: dict[str, Any] | None = None


class PasswordChange(BaseModel):
    current_password: str
    new_password: str = Field(min_length=8, max_length=256)


# ---------- voices ----------
class VoiceOut(ORM):
    id: str
    name: str
    provider: str
    language: str
    gender: str
    description: str
    preview_url: str | None
    is_public: bool
    owner_id: str | None


# ---------- characters ----------
class CharacterBase(BaseModel):
    name: str = Field(min_length=1, max_length=64)
    tagline: str = Field(default="", max_length=140)
    description: str = Field(default="", max_length=20_000)
    greeting: str = Field(default="", max_length=10_000)
    definition: str = Field(default="", max_length=32_000)
    personality: str = Field(default="", max_length=10_000)
    scenario: str = Field(default="", max_length=10_000)
    avatar_url: str | None = None
    voice_id: str | None = None
    visibility: Visibility = "public"
    tags: list[str] = Field(default_factory=list, max_length=20)
    creator_credit: str = Field(default="", max_length=128)
    llm_model: str | None = None
    llm_params: dict[str, Any] = Field(default_factory=dict)

    @field_validator("tags")
    @classmethod
    def _tags(cls, v: list[str]) -> list[str]:
        out: list[str] = []
        for t in v:
            t = t.strip().lower()[:32]
            if t and t not in out:
                out.append(t)
        return out

    @field_validator("llm_params")
    @classmethod
    def _params(cls, v: dict[str, Any]) -> dict[str, Any]:
        allowed = {
            "temperature",
            "top_p",
            "max_tokens",
            "presence_penalty",
            "frequency_penalty",
            "context_tokens",
            "min_p",
            "top_k",
            "repetition_penalty",
        }
        return {k: val for k, val in v.items() if k in allowed and isinstance(val, int | float)}


class CharacterCreate(CharacterBase):
    pass


class CharacterUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=64)
    tagline: str | None = Field(default=None, max_length=140)
    description: str | None = Field(default=None, max_length=20_000)
    greeting: str | None = Field(default=None, max_length=10_000)
    definition: str | None = Field(default=None, max_length=32_000)
    personality: str | None = Field(default=None, max_length=10_000)
    scenario: str | None = Field(default=None, max_length=10_000)
    avatar_url: str | None = None
    voice_id: str | None = None
    visibility: Visibility | None = None
    tags: list[str] | None = None
    creator_credit: str | None = Field(default=None, max_length=128)
    llm_model: str | None = None
    llm_params: dict[str, Any] | None = None

    _tags = field_validator("tags")(lambda cls, v: CharacterBase._tags(v) if v is not None else v)
    _params = field_validator("llm_params")(
        lambda cls, v: CharacterBase._params(v) if v is not None else v
    )


class CharacterCard(ORM):
    """Compact form for discover feeds."""

    id: str
    name: str
    tagline: str
    avatar_url: str | None
    tags: list[str]
    interaction_count: int
    like_count: int
    visibility: str
    creator: UserPublic | None
    creator_credit: str
    featured: bool


class CharacterOut(CharacterCard):
    description: str
    greeting: str
    definition: str | None  # hidden from non-owners
    personality: str | None
    scenario: str | None
    voice_id: str | None
    voice: VoiceOut | None
    llm_model: str | None
    llm_params: dict[str, Any]
    created_at: datetime
    updated_at: datetime
    is_owner: bool = False
    liked: bool = False


class Page[T](BaseModel):
    items: list[T]
    next_cursor: str | None = None
    total: int | None = None


# ---------- personas ----------
class PersonaIn(BaseModel):
    name: str = Field(min_length=1, max_length=64)
    description: str = Field(default="", max_length=4000)
    avatar_url: str | None = None
    is_default: bool = False


class PersonaOut(ORM):
    id: str
    name: str
    description: str
    avatar_url: str | None
    is_default: bool


# ---------- chats ----------
class CandidateOut(ORM):
    id: str
    content: str
    rating: int
    model: str
    created_at: datetime


class MessageOut(ORM):
    id: str
    chat_id: str
    position: int
    role: str
    character_id: str | None
    selected_candidate_id: str | None
    is_pinned: bool
    created_at: datetime
    candidates: list[CandidateOut]


class ChatCreate(BaseModel):
    character_id: str | None = None
    room_id: str | None = None
    persona_id: str | None = None


class ChatUpdate(BaseModel):
    title: str | None = Field(default=None, max_length=128)
    persona_id: str | None = None


class ChatOut(ORM):
    id: str
    character_id: str | None
    room_id: str | None
    persona_id: str | None
    title: str
    created_at: datetime
    updated_at: datetime


class ChatListItem(ChatOut):
    character: CharacterCard | None = None
    room_name: str | None = None
    room_avatars: list[str | None] = Field(default_factory=list)
    last_message: str = ""


class ChatDetail(ChatOut):
    messages: list[MessageOut]
    character: CharacterOut | None = None
    room: RoomOut | None = None
    has_more: bool = False


class SendMessageIn(BaseModel):
    content: str = Field(min_length=1, max_length=8000)


class EditMessageIn(BaseModel):
    content: str = Field(min_length=1, max_length=16_000)


class RateIn(BaseModel):
    rating: int = Field(ge=0, le=4)


class SelectCandidateIn(BaseModel):
    candidate_id: str


class MemoryIn(BaseModel):
    content: str = Field(min_length=1, max_length=2000)


class MemoryOut(ORM):
    id: str
    kind: str
    content: str
    message_id: str | None
    created_at: datetime


# ---------- rooms ----------
class RoomIn(BaseModel):
    name: str = Field(min_length=1, max_length=64)
    topic: str = Field(default="", max_length=4000)
    character_ids: list[str] = Field(min_length=1, max_length=8)
    turn_mode: Literal["auto", "round_robin", "manual"] = "auto"


class RoomMemberOut(ORM):
    character_id: str
    position: int
    character: CharacterCard


class RoomOut(ORM):
    id: str
    name: str
    topic: str
    turn_mode: str
    members: list[RoomMemberOut]
    created_at: datetime


# ---------- misc ----------
class ReportIn(BaseModel):
    target_type: Literal["character", "user", "message"]
    target_id: str
    reason: str = Field(min_length=3, max_length=2000)


class ReportOut(ORM):
    id: str
    reporter_id: str | None
    target_type: str
    target_id: str
    reason: str
    status: str
    created_at: datetime


class JobOut(ORM):
    id: str
    kind: str
    status: str
    result: dict[str, Any]
    error: str
    created_at: datetime
    finished_at: datetime | None


class NotificationOut(ORM):
    id: str
    kind: str
    title: str
    body: str
    data: dict[str, Any]
    read_at: datetime | None
    created_at: datetime


ChatDetail.model_rebuild()
TokenOut.model_rebuild()
