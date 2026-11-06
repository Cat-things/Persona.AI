from __future__ import annotations

import secrets
from datetime import UTC, datetime, timedelta
from typing import Any

from fastapi import APIRouter, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import func, or_, select

from persona.core.deps import DB, AdminUser, CurrentUser
from persona.models import Character, Chat, Invite, Job, Message, Report, User
from persona.schemas import CharacterCard, ReportIn, ReportOut, UserMe
from persona.services import content_filter, settings_store

router = APIRouter(prefix="/admin", tags=["admin"])
reports_router = APIRouter(tags=["reports"])


@reports_router.post("/reports", response_model=ReportOut, status_code=201)
async def create_report(body: ReportIn, db: DB, user: CurrentUser) -> Report:
    r = Report(reporter_id=user.id, **body.model_dump())
    db.add(r)
    await db.commit()
    return r


@router.get("/stats")
async def stats(db: DB, _: AdminUser) -> dict:
    return {
        "users": await db.scalar(select(func.count(User.id))),
        "characters": await db.scalar(select(func.count(Character.id))),
        "chats": await db.scalar(select(func.count(Chat.id))),
        "messages": await db.scalar(select(func.count(Message.id))),
        "open_reports": await db.scalar(
            select(func.count(Report.id)).where(Report.status == "open")
        ),
        "queued_jobs": await db.scalar(
            select(func.count(Job.id)).where(Job.status.in_(["queued", "running"]))
        ),
    }


@router.get("/users", response_model=list[UserMe])
async def list_users(db: DB, _: AdminUser, q: str | None = None, offset: int = 0) -> list[User]:
    stmt = select(User).order_by(User.created_at.desc()).offset(offset).limit(100)
    if q:
        stmt = stmt.where(or_(User.username.ilike(f"%{q}%"), User.email.ilike(f"%{q}%")))
    return list(await db.scalars(stmt))


class UserAdminPatch(BaseModel):
    is_admin: bool | None = None
    is_active: bool | None = None


@router.patch("/users/{user_id}", response_model=UserMe)
async def patch_user(user_id: str, body: UserAdminPatch, db: DB, admin: AdminUser) -> User:
    u = await db.get(User, user_id)
    if u is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "User not found")
    if u.id == admin.id and (body.is_admin is False or body.is_active is False):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "You cannot demote or disable yourself")
    if body.is_admin is not None:
        u.is_admin = body.is_admin
    if body.is_active is not None:
        u.is_active = body.is_active
    await db.commit()
    return u


@router.get("/characters", response_model=list[CharacterCard])
async def list_characters(
    db: DB, _: AdminUser, q: str | None = None, offset: int = 0
) -> list[Character]:
    stmt = select(Character).order_by(Character.created_at.desc()).offset(offset).limit(100)
    if q:
        stmt = stmt.where(Character.name.ilike(f"%{q}%"))
    return list((await db.scalars(stmt)).unique())


class CharacterAdminPatch(BaseModel):
    featured: bool | None = None
    is_removed: bool | None = None


@router.patch("/characters/{character_id}", response_model=CharacterCard)
async def patch_character(
    character_id: str, body: CharacterAdminPatch, db: DB, _: AdminUser
) -> Character:
    c = await db.get(Character, character_id)
    if c is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Character not found")
    if body.featured is not None:
        c.featured = body.featured
    if body.is_removed is not None:
        c.is_removed = body.is_removed
    await db.commit()
    await db.refresh(c)
    return c


@router.get("/reports", response_model=list[ReportOut])
async def list_reports(
    db: DB, _: AdminUser, status_: str = Query("open", alias="status")
) -> list[Report]:
    stmt = select(Report).order_by(Report.created_at.desc()).limit(200)
    if status_ != "all":
        stmt = stmt.where(Report.status == status_)
    return list(await db.scalars(stmt))


class ReportPatch(BaseModel):
    status: str = Field(pattern="^(open|resolved|dismissed)$")


@router.patch("/reports/{report_id}", response_model=ReportOut)
async def patch_report(report_id: str, body: ReportPatch, db: DB, _: AdminUser) -> Report:
    r = await db.get(Report, report_id)
    if r is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Report not found")
    r.status = body.status
    await db.commit()
    return r


@router.get("/settings")
async def get_settings_(db: DB, _: AdminUser) -> dict[str, Any]:
    values = await settings_store.load(db, fresh=True)
    return {
        "values": settings_store.public_view(values),
        "filter_categories": content_filter.CATEGORY_LABELS,
    }


@router.patch("/settings")
async def patch_settings(body: dict[str, Any], db: DB, _: AdminUser) -> dict[str, Any]:
    try:
        values = await settings_store.update(db, body)
    except KeyError as e:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Unknown setting: {e.args[0]}") from e
    except (TypeError, ValueError) as e:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(e)) from e
    return {"values": settings_store.public_view(values)}


class InviteIn(BaseModel):
    max_uses: int = Field(default=1, ge=1, le=1000)
    expires_days: int | None = Field(default=7, ge=1, le=365)


@router.get("/invites")
async def list_invites(db: DB, _: AdminUser) -> list[dict]:
    rows = await db.scalars(select(Invite).order_by(Invite.created_at.desc()).limit(200))
    return [
        {
            "code": i.code,
            "max_uses": i.max_uses,
            "uses": i.uses,
            "expires_at": i.expires_at,
            "created_at": i.created_at,
        }
        for i in rows
    ]


@router.post("/invites", status_code=201)
async def create_invite(body: InviteIn, db: DB, admin: AdminUser) -> dict:
    code = secrets.token_urlsafe(9)
    expires = datetime.now(UTC) + timedelta(days=body.expires_days) if body.expires_days else None
    db.add(Invite(code=code, created_by=admin.id, max_uses=body.max_uses, expires_at=expires))
    await db.commit()
    return {"code": code, "max_uses": body.max_uses, "expires_at": expires}


@router.delete("/invites/{code}", status_code=204)
async def delete_invite(code: str, db: DB, _: AdminUser) -> None:
    inv = await db.get(Invite, code)
    if inv:
        await db.delete(inv)
        await db.commit()


@router.get("/doctor")
async def doctor(_: AdminUser) -> list[dict]:
    from persona.services.doctor import run_checks

    return await run_checks()


@router.get("/llm-models")
async def llm_models(db: DB, _: AdminUser) -> list[str]:
    from persona.services.llm.base import list_models

    return await list_models(await settings_store.load(db, fresh=True))
