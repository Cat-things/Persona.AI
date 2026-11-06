from __future__ import annotations

from tests.conftest import register


async def test_first_user_is_admin(client):
    _, data = await register(client, "root")
    assert data["user"]["is_admin"] is True
    _, data2 = await register(client, "bob")
    assert data2["user"]["is_admin"] is False


async def test_login_and_me(client):
    await register(client, "carol", "s3cret-pass")
    r = await client.post(
        "/api/v1/auth/login", json={"username": "CAROL", "password": "s3cret-pass"}
    )
    assert r.status_code == 200
    token = r.json()["access_token"]
    me = await client.get("/api/v1/me", headers={"Authorization": f"Bearer {token}"})
    assert me.json()["username"] == "carol"
    assert "password_hash" not in me.json()


async def test_wrong_password(client):
    await register(client, "dave")
    r = await client.post("/api/v1/auth/login", json={"username": "dave", "password": "nope-nope"})
    assert r.status_code == 401
    r = await client.post("/api/v1/auth/login", json={"username": "ghost", "password": "nope-nope"})
    assert r.status_code == 401


async def test_duplicate_username(client):
    await register(client, "erin")
    r = await client.post(
        "/api/v1/auth/register", json={"username": "Erin", "password": "password123"}
    )
    assert r.status_code == 409


async def test_invalid_username_and_short_password(client):
    r = await client.post(
        "/api/v1/auth/register", json={"username": "a b", "password": "password123"}
    )
    assert r.status_code == 422
    r = await client.post("/api/v1/auth/register", json={"username": "frank", "password": "short"})
    assert r.status_code == 422


async def test_refresh_rotation_and_reuse_detection(client):
    _, data = await register(client, "gina")
    rt = data["refresh_token"]
    r1 = await client.post("/api/v1/auth/refresh", json={"refresh_token": rt})
    assert r1.status_code == 200
    rt2 = r1.json()["refresh_token"]
    assert rt2 != rt
    # Reusing the old token revokes the family, including the new one.
    r2 = await client.post("/api/v1/auth/refresh", json={"refresh_token": rt})
    assert r2.status_code == 401
    client.cookies.clear()
    r3 = await client.post("/api/v1/auth/refresh", json={"refresh_token": rt2})
    assert r3.status_code == 401


async def test_logout_revokes(client):
    _, data = await register(client, "hank")
    r = await client.post("/api/v1/auth/logout", json={"refresh_token": data["refresh_token"]})
    assert r.status_code == 204
    client.cookies.clear()
    r = await client.post("/api/v1/auth/refresh", json={"refresh_token": data["refresh_token"]})
    assert r.status_code == 401


async def test_invite_only(client, admin):
    r = await client.patch("/api/v1/admin/settings", json={"invite_only": True}, headers=admin)
    assert r.status_code == 200
    r = await client.post(
        "/api/v1/auth/register", json={"username": "ivy", "password": "password123"}
    )
    assert r.status_code == 403
    inv = (await client.post("/api/v1/admin/invites", json={"max_uses": 1}, headers=admin)).json()
    r = await client.post(
        "/api/v1/auth/register",
        json={"username": "ivy", "password": "password123", "invite_code": inv["code"]},
    )
    assert r.status_code == 200
    r = await client.post(
        "/api/v1/auth/register",
        json={"username": "jay", "password": "password123", "invite_code": inv["code"]},
    )
    assert r.status_code == 403


async def test_requires_auth(client):
    r = await client.get("/api/v1/me")
    assert r.status_code == 401
    r = await client.get("/api/v1/me", headers={"Authorization": "Bearer garbage"})
    assert r.status_code == 401


async def test_auth_rate_limit(client, monkeypatch):
    from persona.core.config import get_settings

    monkeypatch.setattr(get_settings(), "rl_auth_per_min", 3)
    codes = []
    for _ in range(5):
        r = await client.post("/api/v1/auth/login", json={"username": "x", "password": "yyyyyyyy"})
        codes.append(r.status_code)
    assert codes[:3] == [401, 401, 401]
    assert codes[3] == 429


async def test_non_admin_cannot_access_admin(client, alice):
    r = await client.get("/api/v1/admin/stats", headers=alice)
    assert r.status_code == 403


async def test_secrets_masked(client, admin):
    r = await client.patch(
        "/api/v1/admin/settings", json={"llm_api_key": "sk-supersecretvalue1234"}, headers=admin
    )
    assert r.status_code == 200
    vals = r.json()["values"]
    assert "supersecret" not in r.text
    assert vals["llm_api_key"].endswith("1234")
    assert vals["llm_api_key_set"] is True
    # Sending the masked value back leaves the secret untouched.
    await client.patch(
        "/api/v1/admin/settings", json={"llm_api_key": vals["llm_api_key"]}, headers=admin
    )
    from persona.db import sessionmaker
    from persona.services import settings_store

    async with sessionmaker()() as db:
        cfg = await settings_store.load(db, fresh=True)
    assert cfg["llm_api_key"] == "sk-supersecretvalue1234"
