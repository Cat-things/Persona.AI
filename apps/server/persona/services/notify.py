"""In-app + Expo push notifications."""

from __future__ import annotations

import logging

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from persona.models import Job, Notification, PushToken

log = logging.getLogger("persona.notify")
EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send"

JOB_MESSAGES = {
    "avatar": ("Avatars ready", "Your avatar options are ready to pick from."),
}


async def notify(
    db: AsyncSession, user_id: str, kind: str, title: str, body: str, data: dict | None = None
) -> None:
    db.add(Notification(user_id=user_id, kind=kind, title=title, body=body, data=data or {}))
    await db.commit()
    tokens = list(await db.scalars(select(PushToken.token).where(PushToken.user_id == user_id)))
    if not tokens:
        return
    msgs = [
        {"to": t, "title": title, "body": body, "data": data or {}, "sound": "default"}
        for t in tokens
    ]
    try:
        async with httpx.AsyncClient(timeout=10) as c:
            await c.post(EXPO_PUSH_URL, json=msgs)
    except httpx.HTTPError:
        log.info("expo push failed (offline instance?)")


async def job_finished(db: AsyncSession, job: Job) -> None:
    if not job.user_id or job.kind not in JOB_MESSAGES:
        return
    title, body = JOB_MESSAGES[job.kind]
    if job.status == "error":
        title, body = "Generation failed", job.error[:200]
    await notify(
        db,
        job.user_id,
        f"job.{job.kind}",
        title,
        body,
        {"job_id": job.id, "kind": job.kind, "status": job.status},
    )
