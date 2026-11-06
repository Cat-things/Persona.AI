from __future__ import annotations

import asyncio

from alembic import context
from sqlalchemy.ext.asyncio import create_async_engine

from persona import models  # noqa: F401
from persona.db import Base

config = context.config
target_metadata = Base.metadata


def _do_run(connection) -> None:
    context.configure(
        connection=connection,
        target_metadata=target_metadata,
        render_as_batch=connection.dialect.name == "sqlite",
        compare_type=True,
    )
    with context.begin_transaction():
        context.run_migrations()


async def _run_async() -> None:
    engine = create_async_engine(config.get_main_option("sqlalchemy.url"))
    async with engine.connect() as conn:
        await conn.run_sync(_do_run)
    await engine.dispose()


def run_migrations_online() -> None:
    try:
        asyncio.get_running_loop()
    except RuntimeError:
        asyncio.run(_run_async())
        return
    # Called from inside a running loop (e.g. app lifespan): run in a helper thread.
    import threading

    err: list[BaseException] = []

    def _t() -> None:
        try:
            asyncio.run(_run_async())
        except BaseException as e:  # noqa: BLE001
            err.append(e)

    th = threading.Thread(target=_t)
    th.start()
    th.join()
    if err:
        raise err[0]


if context.is_offline_mode():
    context.configure(
        url=config.get_main_option("sqlalchemy.url"),
        target_metadata=target_metadata,
        literal_binds=True,
        render_as_batch=True,
    )
    with context.begin_transaction():
        context.run_migrations()
else:
    run_migrations_online()
