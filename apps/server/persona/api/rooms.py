"""Rooms: group chats with several characters and turn-taking."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from persona.api.characters import get_visible
from persona.core.deps import DB, CurrentUser
from persona.models import Room, RoomMember, User
from persona.schemas import RoomCreated, RoomIn, RoomOut, RoomUpdate
from persona.services import chat_engine

router = APIRouter(prefix="/rooms", tags=["rooms"])

MAX_ROOMS = 100


async def _owned(db: AsyncSession, room_id: str, user: User) -> Room:
    room = await db.get(Room, room_id)
    if room is None or room.owner_id != user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Room not found")
    return room


async def _members(db: AsyncSession, ids: list[str], user: User) -> list[RoomMember]:
    seen: list[str] = []
    for cid in ids:
        if cid not in seen:
            seen.append(cid)
    if len(seen) < 2:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "A room needs at least two characters")
    for cid in seen:
        await get_visible(db, cid, user)  # 404s for characters the user can't see
    return [RoomMember(character_id=cid, position=i) for i, cid in enumerate(seen)]


@router.get("", response_model=list[RoomOut])
async def list_rooms(db: DB, user: CurrentUser) -> list[Room]:
    rows = await db.scalars(
        select(Room).where(Room.owner_id == user.id).order_by(Room.created_at.desc())
    )
    return list(rows)


@router.post("", response_model=RoomCreated, status_code=201)
async def create_room(body: RoomIn, db: DB, user: CurrentUser) -> RoomCreated:
    count = len(list(await db.scalars(select(Room.id).where(Room.owner_id == user.id))))
    if count >= MAX_ROOMS:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"At most {MAX_ROOMS} rooms")
    members = await _members(db, body.character_ids, user)
    room = Room(owner_id=user.id, name=body.name, topic=body.topic, turn_mode=body.turn_mode)
    room.members = members
    db.add(room)
    await db.commit()
    room = await db.get(Room, room.id, populate_existing=True)
    assert room is not None
    chat = await chat_engine.create_chat(db, user, None, room=room)
    out = RoomOut.model_validate(room).model_dump()
    return RoomCreated(**out, chat_id=chat.id)


@router.get("/{room_id}", response_model=RoomOut)
async def get_room(room_id: str, db: DB, user: CurrentUser) -> Room:
    return await _owned(db, room_id, user)


@router.patch("/{room_id}", response_model=RoomOut)
async def update_room(room_id: str, body: RoomUpdate, db: DB, user: CurrentUser) -> Room:
    room = await _owned(db, room_id, user)
    changes = body.model_dump(exclude_unset=True)
    ids = changes.pop("character_ids", None)
    for k, v in changes.items():
        if v is not None:
            setattr(room, k, v)
    if ids is not None:
        new = await _members(db, ids, user)
        room.members.clear()
        await db.flush()
        room.members.extend(new)
    await db.commit()
    room = await db.get(Room, room_id, populate_existing=True)
    assert room is not None
    return room


@router.delete("/{room_id}", status_code=204)
async def delete_room(room_id: str, db: DB, user: CurrentUser) -> None:
    room = await _owned(db, room_id, user)
    await db.delete(room)  # its chats cascade
    await db.commit()
