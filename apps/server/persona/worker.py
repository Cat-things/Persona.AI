"""Background worker: `persona worker`. Polls the jobs table; Redis pub/sub wakes it early."""

from __future__ import annotations

import asyncio
import logging
import signal
from datetime import UTC, datetime, timedelta

from sqlalchemy import update

from persona.db import sessionmaker
from persona.models import Job
from persona.services import jobs

log = logging.getLogger("persona.worker")


def load_handlers() -> None:
    # Import modules that register job handlers.
    import importlib

    for mod in (
        "persona.services.memory",
        "persona.services.imagegen.service",
        "persona.services.tts.service",
    ):
        try:
            importlib.import_module(mod)
        except ModuleNotFoundError as e:
            if e.name != mod:
                raise


async def _requeue_stale() -> None:
    """Jobs left 'running' by a crashed worker go back to the queue."""
    async with sessionmaker()() as db:
        cutoff = datetime.now(UTC) - timedelta(minutes=15)
        await db.execute(
            update(Job)
            .where(Job.status == "running", Job.started_at < cutoff)
            .values(status="queued")
        )
        await db.commit()


async def _waiter(event: asyncio.Event) -> None:
    from persona.core.config import get_settings

    url = get_settings().redis_url
    if not url:
        return
    try:
        import redis.asyncio as redis

        ps = redis.from_url(url).pubsub()
        await ps.subscribe("persona:jobs")
        async for msg in ps.listen():
            if msg.get("type") == "message":
                event.set()
    except Exception:  # noqa: BLE001
        log.info("redis wakeups unavailable; polling only")


async def _loop(stop: asyncio.Event, wake: asyncio.Event) -> None:
    while not stop.is_set():
        async with sessionmaker()() as db:
            job = await jobs.claim(db)
            if job is not None:
                log.info("running job %s (%s)", job.id, job.kind)
                await jobs.run_one(db, job)
                continue
        wake.clear()
        try:
            await asyncio.wait_for(wake.wait(), timeout=2.0)
        except TimeoutError:
            pass


async def run_worker(concurrency: int = 2) -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(message)s")
    load_handlers()
    await _requeue_stale()
    stop, wake = asyncio.Event(), asyncio.Event()
    loop = asyncio.get_running_loop()
    for sig in (signal.SIGINT, signal.SIGTERM):
        try:
            loop.add_signal_handler(sig, stop.set)
        except NotImplementedError:  # Windows
            pass
    log.info("worker started (concurrency=%d)", concurrency)
    waiter = asyncio.create_task(_waiter(wake))
    await asyncio.gather(*(_loop(stop, wake) for _ in range(concurrency)))
    waiter.cancel()
