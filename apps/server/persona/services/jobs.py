"""DB-backed job queue. Handlers register by kind; the worker claims queued jobs."""

from __future__ import annotations

import logging
from collections.abc import Awaitable, Callable
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from persona.models import Job

log = logging.getLogger("persona.jobs")

Handler = Callable[[AsyncSession, Job], Awaitable[dict[str, Any]]]
HANDLERS: dict[str, Handler] = {}
MAX_ATTEMPTS = 3


def handler(kind: str) -> Callable[[Handler], Handler]:
    def deco(fn: Handler) -> Handler:
        HANDLERS[kind] = fn
        return fn

    return deco


async def enqueue(
    db: AsyncSession, kind: str, payload: dict[str, Any], user_id: str | None = None
) -> Job:
    job = Job(kind=kind, payload=payload, user_id=user_id)
    db.add(job)
    await db.commit()
    await _wake()
    return job


async def _wake() -> None:
    from persona.core.config import get_settings

    url = get_settings().redis_url
    if not url:
        return
    try:
        import redis.asyncio as redis

        await redis.from_url(url).publish("persona:jobs", "1")
    except Exception:  # noqa: BLE001
        pass


async def claim(db: AsyncSession, kinds: list[str] | None = None) -> Job | None:
    """Atomically claim the oldest queued job (works on SQLite and Postgres)."""
    stmt = select(Job.id).where(Job.status == "queued").order_by(Job.created_at).limit(1)
    if kinds:
        stmt = stmt.where(Job.kind.in_(kinds))
    job_id = await db.scalar(stmt)
    if job_id is None:
        return None
    res = await db.execute(
        update(Job)
        .where(Job.id == job_id, Job.status == "queued")
        .values(status="running", started_at=datetime.now(UTC), attempts=Job.attempts + 1)
    )
    await db.commit()
    if res.rowcount != 1:
        return None  # another worker got it
    return await db.get(Job, job_id, populate_existing=True)


async def run_one(db: AsyncSession, job: Job) -> None:
    fn = HANDLERS.get(job.kind)
    try:
        if fn is None:
            raise RuntimeError(f"No handler for job kind {job.kind!r}")
        job.result = await fn(db, job)
        job.status = "done"
        job.error = ""
    except Exception as e:  # noqa: BLE001
        log.exception("job %s (%s) failed", job.id, job.kind)
        job.error = f"{type(e).__name__}: {e}"[:2000]
        job.status = "queued" if job.attempts < MAX_ATTEMPTS and _retryable(e) else "error"
    job.finished_at = datetime.now(UTC)
    await db.commit()
    if job.status in ("done", "error"):
        try:
            from persona.services.notify import job_finished

            await job_finished(db, job)
        except Exception:  # noqa: BLE001
            log.exception("notification for job %s failed", job.id)


def _retryable(e: Exception) -> bool:
    import httpx

    return isinstance(e, httpx.TransportError | TimeoutError | ConnectionError)
