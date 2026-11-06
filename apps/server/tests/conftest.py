from __future__ import annotations

import os
import tempfile

_tmp = tempfile.mkdtemp(prefix="persona-test-")
os.environ.update(
    {
        "ENVIRONMENT": "test",
        "SECRET_KEY": "test-secret-key-0123456789abcdef",
        "DATA_DIR": _tmp,
        "DATABASE_URL": f"sqlite+aiosqlite:///{_tmp}/test.db",
        "LLM_BASE_URL": "http://llm.invalid/v1",
        "TTS_PROVIDER": "none",
        "STT_PROVIDER": "none",
        "RL_AUTH_PER_MIN": "1000",
        "RL_CHAT_PER_MIN": "1000",
        "RL_GEN_PER_MIN": "1000",
    }
)

import httpx  # noqa: E402
import pytest  # noqa: E402
from asgi_lifespan import LifespanManager  # noqa: E402

from persona.core.ratelimit import get_limiter  # noqa: E402
from persona.db import Base, get_engine  # noqa: E402
from persona.main import app  # noqa: E402
from persona.services import settings_store  # noqa: E402


@pytest.fixture(autouse=True)
async def _fresh_db():
    from persona import models  # noqa: F401

    engine = get_engine()
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
        await conn.run_sync(Base.metadata.create_all)
    settings_store.invalidate()
    get_limiter().reset()
    yield


@pytest.fixture
async def client():
    async with LifespanManager(app):
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as c:
            yield c


async def register(client, username="alice", password="password123", **extra):
    r = await client.post(
        "/api/v1/auth/register", json={"username": username, "password": password, **extra}
    )
    assert r.status_code == 200, r.text
    data = r.json()
    return {"Authorization": f"Bearer {data['access_token']}"}, data


@pytest.fixture
async def admin(client):
    headers, _ = await register(client, "admin")
    return headers


@pytest.fixture
async def alice(client, admin):
    headers, _ = await register(client, "alice")
    return headers
