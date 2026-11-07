"""SQLAlchemy models. IDs are 32-char hex UUIDs stored as strings (portable SQLite/Postgres)."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import (
    JSON,
    Boolean,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    TypeDecorator,
    UniqueConstraint,
    false,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from persona.db import Base


def new_id() -> str:
    return uuid.uuid4().hex


def utcnow() -> datetime:
    return datetime.now(UTC)


class TZDateTime(TypeDecorator):
    """DateTime that always round-trips as timezone-aware UTC (SQLite drops tzinfo)."""

    impl = DateTime(timezone=True)
    cache_ok = True

    def process_bind_param(self, value, dialect):
        if isinstance(value, datetime) and value.tzinfo is not None:
            value = value.astimezone(UTC)
            if dialect.name == "sqlite":
                value = value.replace(tzinfo=None)
        return value

    def process_result_value(self, value, dialect):
        if isinstance(value, datetime) and value.tzinfo is None:
            value = value.replace(tzinfo=UTC)
        return value


def id_col() -> Mapped[str]:
    return mapped_column(String(32), primary_key=True, default=new_id)


def created_col() -> Mapped[datetime]:
    return mapped_column(TZDateTime(), default=utcnow, nullable=False)


class User(Base):
    __tablename__ = "users"
    id: Mapped[str] = id_col()
    username: Mapped[str] = mapped_column(String(32), unique=True, index=True)
    email: Mapped[str | None] = mapped_column(String(255), unique=True, nullable=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    display_name: Mapped[str] = mapped_column(String(64), default="")
    bio: Mapped[str] = mapped_column(Text, default="")
    avatar_url: Mapped[str | None] = mapped_column(String(512), nullable=True)
    is_admin: Mapped[bool] = mapped_column(Boolean, default=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    preferences: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = created_col()


class RefreshToken(Base):
    __tablename__ = "refresh_tokens"
    id: Mapped[str] = id_col()
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    family: Mapped[str] = mapped_column(String(32), index=True)
    expires_at: Mapped[datetime] = mapped_column(TZDateTime())
    revoked_at: Mapped[datetime | None] = mapped_column(TZDateTime(), nullable=True)
    user_agent: Mapped[str] = mapped_column(String(255), default="")
    created_at: Mapped[datetime] = created_col()


class Invite(Base):
    __tablename__ = "invites"
    code: Mapped[str] = mapped_column(String(32), primary_key=True)
    created_by: Mapped[str | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    max_uses: Mapped[int] = mapped_column(Integer, default=1)
    uses: Mapped[int] = mapped_column(Integer, default=0)
    expires_at: Mapped[datetime | None] = mapped_column(TZDateTime(), nullable=True)
    created_at: Mapped[datetime] = created_col()


class Character(Base):
    __tablename__ = "characters"
    id: Mapped[str] = id_col()
    creator_id: Mapped[str | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
    )
    name: Mapped[str] = mapped_column(String(64), index=True)
    tagline: Mapped[str] = mapped_column(String(140), default="")
    description: Mapped[str] = mapped_column(Text, default="")
    greeting: Mapped[str] = mapped_column(Text, default="")
    definition: Mapped[str] = mapped_column(Text, default="")  # example dialogs / advanced
    personality: Mapped[str] = mapped_column(Text, default="")
    scenario: Mapped[str] = mapped_column(Text, default="")
    avatar_url: Mapped[str | None] = mapped_column(String(512), nullable=True)
    voice_id: Mapped[str | None] = mapped_column(
        ForeignKey("voices.id", ondelete="SET NULL"), nullable=True
    )
    visibility: Mapped[str] = mapped_column(String(16), default="public", index=True)
    tags: Mapped[list[str]] = mapped_column(JSON, default=list)
    tags_text: Mapped[str] = mapped_column(String(1024), default="", index=True)  # "|a|b|"
    creator_credit: Mapped[str] = mapped_column(String(128), default="")
    llm_model: Mapped[str | None] = mapped_column(String(128), nullable=True)
    llm_params: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    extensions: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)  # card passthrough
    interaction_count: Mapped[int] = mapped_column(Integer, default=0, index=True)
    like_count: Mapped[int] = mapped_column(Integer, default=0)
    featured: Mapped[bool] = mapped_column(Boolean, default=False, index=True)
    is_removed: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = created_col()
    updated_at: Mapped[datetime] = mapped_column(TZDateTime(), default=utcnow, onupdate=utcnow)

    creator: Mapped[User | None] = relationship(lazy="joined")
    voice: Mapped[Voice | None] = relationship(lazy="joined")


class CharacterLike(Base):
    __tablename__ = "character_likes"
    user_id: Mapped[str] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    character_id: Mapped[str] = mapped_column(
        ForeignKey("characters.id", ondelete="CASCADE"), primary_key=True
    )
    created_at: Mapped[datetime] = created_col()


class Persona(Base):
    __tablename__ = "personas"
    id: Mapped[str] = id_col()
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(64))
    description: Mapped[str] = mapped_column(Text, default="")
    avatar_url: Mapped[str | None] = mapped_column(String(512), nullable=True)
    is_default: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = created_col()


class Room(Base):
    __tablename__ = "rooms"
    id: Mapped[str] = id_col()
    owner_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(64))
    topic: Mapped[str] = mapped_column(Text, default="")
    turn_mode: Mapped[str] = mapped_column(String(16), default="auto")  # auto|round_robin|manual
    created_at: Mapped[datetime] = created_col()

    members: Mapped[list[RoomMember]] = relationship(
        lazy="selectin", order_by="RoomMember.position", cascade="all, delete-orphan"
    )


class RoomMember(Base):
    __tablename__ = "room_members"
    room_id: Mapped[str] = mapped_column(
        ForeignKey("rooms.id", ondelete="CASCADE"), primary_key=True
    )
    character_id: Mapped[str] = mapped_column(
        ForeignKey("characters.id", ondelete="CASCADE"), primary_key=True
    )
    position: Mapped[int] = mapped_column(Integer, default=0)

    character: Mapped[Character] = relationship(lazy="joined")


class Chat(Base):
    __tablename__ = "chats"
    id: Mapped[str] = id_col()
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    character_id: Mapped[str | None] = mapped_column(
        ForeignKey("characters.id", ondelete="CASCADE"), nullable=True, index=True
    )
    room_id: Mapped[str | None] = mapped_column(
        ForeignKey("rooms.id", ondelete="CASCADE"), nullable=True, index=True
    )
    persona_id: Mapped[str | None] = mapped_column(
        ForeignKey("personas.id", ondelete="SET NULL"), nullable=True
    )
    title: Mapped[str] = mapped_column(String(128), default="")
    next_position: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = created_col()
    updated_at: Mapped[datetime] = mapped_column(TZDateTime(), default=utcnow, index=True)


class Message(Base):
    __tablename__ = "messages"
    __table_args__ = (Index("ix_messages_chat_pos", "chat_id", "position"),)
    id: Mapped[str] = id_col()
    chat_id: Mapped[str] = mapped_column(ForeignKey("chats.id", ondelete="CASCADE"))
    position: Mapped[int] = mapped_column(Integer)
    role: Mapped[str] = mapped_column(String(16))  # user | assistant | narrator
    character_id: Mapped[str | None] = mapped_column(
        ForeignKey("characters.id", ondelete="SET NULL"), nullable=True
    )
    selected_candidate_id: Mapped[str | None] = mapped_column(String(32), nullable=True)
    is_pinned: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = created_col()

    candidates: Mapped[list[MessageCandidate]] = relationship(
        lazy="selectin",
        order_by="MessageCandidate.created_at",
        cascade="all, delete-orphan",
    )

    @property
    def selected(self) -> MessageCandidate | None:
        for c in self.candidates:
            if c.id == self.selected_candidate_id:
                return c
        return self.candidates[-1] if self.candidates else None

    @property
    def text(self) -> str:
        sel = self.selected
        return sel.content if sel else ""


class MessageCandidate(Base):
    __tablename__ = "message_candidates"
    id: Mapped[str] = id_col()
    message_id: Mapped[str] = mapped_column(
        ForeignKey("messages.id", ondelete="CASCADE"), index=True
    )
    content: Mapped[str] = mapped_column(Text, default="")
    rating: Mapped[int] = mapped_column(Integer, default=0)  # 0 = unrated, 1..4 stars
    model: Mapped[str] = mapped_column(String(128), default="")
    finish_reason: Mapped[str] = mapped_column(String(32), default="")
    # The model refused (or the filter hid the reply); drives the escalating warnings.
    is_refusal: Mapped[bool] = mapped_column(Boolean, default=False, server_default=false())
    created_at: Mapped[datetime] = created_col()


class Memory(Base):
    __tablename__ = "memories"
    id: Mapped[str] = id_col()
    chat_id: Mapped[str] = mapped_column(ForeignKey("chats.id", ondelete="CASCADE"), index=True)
    kind: Mapped[str] = mapped_column(String(16))  # pinned | summary
    content: Mapped[str] = mapped_column(Text)
    message_id: Mapped[str | None] = mapped_column(
        ForeignKey("messages.id", ondelete="CASCADE"), nullable=True
    )
    covers_until: Mapped[int] = mapped_column(Integer, default=-1)  # message position (summary)
    created_at: Mapped[datetime] = created_col()


class Voice(Base):
    __tablename__ = "voices"
    id: Mapped[str] = id_col()
    owner_id: Mapped[str | None] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=True, index=True
    )
    name: Mapped[str] = mapped_column(String(64))
    provider: Mapped[str] = mapped_column(String(32))
    provider_voice_id: Mapped[str] = mapped_column(String(255))
    language: Mapped[str] = mapped_column(String(16), default="en")
    gender: Mapped[str] = mapped_column(String(16), default="")
    description: Mapped[str] = mapped_column(String(255), default="")
    sample_path: Mapped[str | None] = mapped_column(String(512), nullable=True)
    preview_url: Mapped[str | None] = mapped_column(String(512), nullable=True)
    is_public: Mapped[bool] = mapped_column(Boolean, default=True)
    rights_confirmed: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = created_col()


class Media(Base):
    __tablename__ = "media"
    id: Mapped[str] = id_col()
    owner_id: Mapped[str | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    kind: Mapped[str] = mapped_column(String(16))  # image | audio
    path: Mapped[str] = mapped_column(String(512))  # relative to media dir
    mime: Mapped[str] = mapped_column(String(64))
    size: Mapped[int] = mapped_column(Integer)
    created_at: Mapped[datetime] = created_col()


class Job(Base):
    __tablename__ = "jobs"
    id: Mapped[str] = id_col()
    kind: Mapped[str] = mapped_column(String(32), index=True)
    status: Mapped[str] = mapped_column(String(16), default="queued", index=True)
    user_id: Mapped[str | None] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=True, index=True
    )
    payload: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    result: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    error: Mapped[str] = mapped_column(Text, default="")
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = created_col()
    started_at: Mapped[datetime | None] = mapped_column(TZDateTime(), nullable=True)
    finished_at: Mapped[datetime | None] = mapped_column(TZDateTime(), nullable=True)


class Report(Base):
    __tablename__ = "reports"
    id: Mapped[str] = id_col()
    reporter_id: Mapped[str | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    target_type: Mapped[str] = mapped_column(String(16))  # character | user | message
    target_id: Mapped[str] = mapped_column(String(32))
    reason: Mapped[str] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(16), default="open")  # open | resolved | dismissed
    created_at: Mapped[datetime] = created_col()


class SettingKV(Base):
    __tablename__ = "settings"
    key: Mapped[str] = mapped_column(String(64), primary_key=True)
    value: Mapped[Any] = mapped_column(JSON)
    updated_at: Mapped[datetime] = mapped_column(TZDateTime(), default=utcnow, onupdate=utcnow)


class PushToken(Base):
    __tablename__ = "push_tokens"
    __table_args__ = (UniqueConstraint("token"),)
    id: Mapped[str] = id_col()
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    token: Mapped[str] = mapped_column(String(255))
    platform: Mapped[str] = mapped_column(String(16), default="")
    created_at: Mapped[datetime] = created_col()


class Notification(Base):
    __tablename__ = "notifications"
    id: Mapped[str] = id_col()
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    kind: Mapped[str] = mapped_column(String(32))
    title: Mapped[str] = mapped_column(String(128))
    body: Mapped[str] = mapped_column(Text, default="")
    data: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    read_at: Mapped[datetime | None] = mapped_column(TZDateTime(), nullable=True)
    created_at: Mapped[datetime] = created_col()
