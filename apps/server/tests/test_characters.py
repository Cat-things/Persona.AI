from __future__ import annotations

import io

from PIL import Image

from tests.conftest import register

CHAR = {
    "name": "Captain Vela",
    "tagline": "Starship captain with a dry wit",
    "description": "A veteran captain of the freighter Marigold.",
    "greeting": "Welcome aboard. Mind the cargo.",
    "definition": "{{user}}: Hi\n{{char}}: *nods* Hello.",
    "tags": ["Sci-Fi", "adventure", "sci-fi"],
}


async def test_crud_and_visibility(client, admin, alice):
    r = await client.post("/api/v1/characters", json=CHAR, headers=alice)
    assert r.status_code == 201, r.text
    c = r.json()
    assert c["tags"] == ["sci-fi", "adventure"]
    assert c["creator"]["username"] == "alice"
    assert c["definition"] == CHAR["definition"]

    bob, _ = await register(client, "bob")
    other = (await client.get(f"/api/v1/characters/{c['id']}", headers=bob)).json()
    assert other["definition"] is None  # hidden from non-owners

    r = await client.patch(f"/api/v1/characters/{c['id']}", json={"name": "Hacked"}, headers=bob)
    assert r.status_code == 403

    r = await client.patch(
        f"/api/v1/characters/{c['id']}", json={"visibility": "private"}, headers=alice
    )
    assert r.json()["visibility"] == "private"
    assert (await client.get(f"/api/v1/characters/{c['id']}", headers=bob)).status_code == 404
    assert (await client.get(f"/api/v1/characters/{c['id']}", headers=admin)).status_code == 200

    r = await client.delete(f"/api/v1/characters/{c['id']}", headers=alice)
    assert r.status_code == 204
    assert (await client.get(f"/api/v1/characters/{c['id']}", headers=alice)).status_code == 404


async def test_discover_search_and_tags(client, alice):
    for i, (name, tags) in enumerate(
        [("Wizard Mo", ["fantasy"]), ("Detective Ray", ["mystery"]), ("Hidden One", ["fantasy"])]
    ):
        body = {**CHAR, "name": name, "tags": tags}
        if i == 2:
            body["visibility"] = "unlisted"
        assert (
            await client.post("/api/v1/characters", json=body, headers=alice)
        ).status_code == 201
    r = await client.get("/api/v1/characters?sort=recent", headers=alice)
    names = [c["name"] for c in r.json()["items"]]
    assert names == ["Detective Ray", "Wizard Mo"]  # unlisted excluded
    r = await client.get("/api/v1/characters?q=wiz", headers=alice)
    assert [c["name"] for c in r.json()["items"]] == ["Wizard Mo"]
    r = await client.get("/api/v1/characters?tag=mystery", headers=alice)
    assert [c["name"] for c in r.json()["items"]] == ["Detective Ray"]
    r = await client.get("/api/v1/characters?sort=trending", headers=alice)
    assert r.status_code == 200
    tags = (await client.get("/api/v1/characters/tags", headers=alice)).json()
    assert {"tag": "fantasy", "count": 1} in tags


async def test_pagination(client, alice):
    for i in range(5):
        await client.post("/api/v1/characters", json={**CHAR, "name": f"C{i}"}, headers=alice)
    r = (await client.get("/api/v1/characters?sort=recent&limit=2", headers=alice)).json()
    assert len(r["items"]) == 2 and r["next_cursor"] == "2"
    r = (await client.get("/api/v1/characters?sort=recent&limit=2&cursor=4", headers=alice)).json()
    assert len(r["items"]) == 1 and r["next_cursor"] is None


async def test_like(client, alice):
    c = (await client.post("/api/v1/characters", json=CHAR, headers=alice)).json()
    r = await client.post(f"/api/v1/characters/{c['id']}/like", headers=alice)
    assert r.json()["liked"] is True and r.json()["like_count"] == 1
    r = await client.post(f"/api/v1/characters/{c['id']}/like", headers=alice)
    assert r.json()["like_count"] == 1
    liked = (await client.get("/api/v1/characters/liked", headers=alice)).json()
    assert [x["id"] for x in liked] == [c["id"]]
    r = await client.delete(f"/api/v1/characters/{c['id']}/like", headers=alice)
    assert r.json()["like_count"] == 0


async def test_content_filter_blocks_public(client, alice):
    bad = {**CHAR, "description": "A 12 year old in a sexual scenario"}
    r = await client.post("/api/v1/characters", json=bad, headers=alice)
    assert r.status_code == 422
    # always-on category also applies to private characters
    r = await client.post(
        "/api/v1/characters", json={**bad, "visibility": "private"}, headers=alice
    )
    assert r.status_code == 422
    explicit = {**CHAR, "description": "she grabs his cock"}
    assert (
        await client.post("/api/v1/characters", json=explicit, headers=alice)
    ).status_code == 422
    r = await client.post(
        "/api/v1/characters", json={**explicit, "visibility": "private"}, headers=alice
    )
    assert r.status_code == 201


async def test_image_upload_validation(client, alice):
    buf = io.BytesIO()
    Image.new("RGB", (64, 64), "orange").save(buf, "PNG")
    r = await client.post(
        "/api/v1/media/images",
        headers=alice,
        files={"file": ("a.png", buf.getvalue(), "image/png")},
    )
    assert r.status_code == 200, r.text
    url = r.json()["url"]
    assert url.endswith(".webp")
    got = await client.get(url)
    assert got.status_code == 200 and got.content[:4] == b"RIFF"

    r = await client.post(
        "/api/v1/media/images",
        headers=alice,
        files={"file": ("x.png", b"<?php echo 1; ?>", "image/png")},
    )
    assert r.status_code == 415


async def test_admin_feature_and_remove(client, admin, alice):
    c = (await client.post("/api/v1/characters", json=CHAR, headers=alice)).json()
    r = await client.patch(
        f"/api/v1/admin/characters/{c['id']}", json={"featured": True}, headers=admin
    )
    assert r.json()["featured"] is True
    feat = (await client.get("/api/v1/characters?sort=featured", headers=alice)).json()["items"]
    assert [x["id"] for x in feat] == [c["id"]]
    await client.patch(
        f"/api/v1/admin/characters/{c['id']}", json={"is_removed": True}, headers=admin
    )
    assert (await client.get(f"/api/v1/characters/{c['id']}", headers=alice)).status_code == 404


async def test_report(client, alice, admin):
    c = (await client.post("/api/v1/characters", json=CHAR, headers=alice)).json()
    r = await client.post(
        "/api/v1/reports",
        headers=alice,
        json={"target_type": "character", "target_id": c["id"], "reason": "spam"},
    )
    assert r.status_code == 201
    reports = (await client.get("/api/v1/admin/reports", headers=admin)).json()
    assert len(reports) == 1
