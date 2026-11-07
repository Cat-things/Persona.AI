from __future__ import annotations

import base64
import io
import json

from PIL import Image, PngImagePlugin

from tests.conftest import make_character, register, sse_events

API = "/api/v1"


# ---------- personas ----------
async def test_persona_crud_and_single_default(client, alice):
    r = await client.post(
        f"{API}/personas", json={"name": "Rook", "description": "A smuggler."}, headers=alice
    )
    assert r.status_code == 201, r.text
    rook = r.json()
    assert rook["is_default"] is False
    nova = (
        await client.post(
            f"{API}/personas", json={"name": "Nova", "is_default": True}, headers=alice
        )
    ).json()
    assert nova["is_default"] is True
    r = await client.patch(f"{API}/personas/{rook['id']}", json={"is_default": True}, headers=alice)
    assert r.json()["is_default"] is True
    ps = {p["name"]: p for p in (await client.get(f"{API}/personas", headers=alice)).json()}
    assert ps["Rook"]["is_default"] and not ps["Nova"]["is_default"]

    # New chats pick up the default persona, and the greeting uses its name.
    c = await make_character(client, alice)
    chat = (await client.post(f"{API}/chats", json={"character_id": c["id"]}, headers=alice)).json()
    assert chat["persona_id"] == rook["id"]
    detail = (await client.get(f"{API}/chats/{chat['id']}", headers=alice)).json()
    assert detail["messages"][0]["candidates"][0]["content"] == "Welcome aboard, Rook."

    # Switch persona mid-chat, then delete it: chat survives with no persona.
    r = await client.patch(
        f"{API}/chats/{chat['id']}", json={"persona_id": nova["id"]}, headers=alice
    )
    assert r.json()["persona_id"] == nova["id"]
    assert (await client.delete(f"{API}/personas/{nova['id']}", headers=alice)).status_code == 204
    chat2 = (await client.get(f"{API}/chats/{chat['id']}", headers=alice)).json()
    assert chat2["persona_id"] is None

    assert (await client.delete(f"{API}/personas/{rook['id']}", headers=alice)).status_code == 204
    me = (await client.get(f"{API}/users/me", headers=alice)).json()
    assert "default_persona_id" not in (me.get("preferences") or {})


async def test_persona_privacy_and_avatar_rule(client, alice):
    bob, _ = await register(client, "bob")
    p = (await client.post(f"{API}/personas", json={"name": "Mine"}, headers=alice)).json()
    assert (
        await client.patch(f"{API}/personas/{p['id']}", json={}, headers=bob)
    ).status_code == 404
    assert (await client.delete(f"{API}/personas/{p['id']}", headers=bob)).status_code == 404
    assert (await client.get(f"{API}/personas", headers=bob)).json() == []
    c = await make_character(client, bob)
    r = await client.post(
        f"{API}/chats", json={"character_id": c["id"], "persona_id": p["id"]}, headers=bob
    )
    assert r.status_code == 400
    r = await client.post(
        f"{API}/personas",
        json={"name": "X", "avatar_url": "https://tracker.example/pixel.gif"},
        headers=alice,
    )
    assert r.status_code == 400


# ---------- rooms ----------
async def test_room_create_turns_and_edit(client, alice):
    a = await make_character(client, alice, name="Vela", greeting="Hi from Vela.")
    b = await make_character(client, alice, name="Orrin", greeting="Orrin here.")
    c = await make_character(client, alice, name="Pip", greeting="")
    r = await client.post(
        f"{API}/rooms",
        json={"name": "Bridge", "character_ids": [a["id"], b["id"]], "turn_mode": "round_robin"},
        headers=alice,
    )
    assert r.status_code == 201, r.text
    room = r.json()
    assert [m["character"]["name"] for m in room["members"]] == ["Vela", "Orrin"]
    chat_id = room["chat_id"]
    detail = (await client.get(f"{API}/chats/{chat_id}", headers=alice)).json()
    assert detail["room"]["id"] == room["id"]
    assert detail["messages"][0]["character_id"] == a["id"]

    # Round robin: Vela spoke last (greeting), so Orrin answers next.
    r = await client.post(
        f"{API}/chats/{chat_id}/messages", json={"content": "Status report?"}, headers=alice
    )
    done = [e for e in sse_events(r.text) if e["type"] == "done"]
    assert done and done[0]["message"]["character_id"] == b["id"]

    # Naming a character makes them answer.
    r = await client.post(
        f"{API}/chats/{chat_id}/messages", json={"content": "Orrin, again please"}, headers=alice
    )
    done = [e for e in sse_events(r.text) if e["type"] == "done"]
    assert done[0]["message"]["character_id"] == b["id"]

    r = await client.patch(
        f"{API}/rooms/{room['id']}",
        json={"name": "Deck", "character_ids": [c["id"], a["id"], c["id"]]},
        headers=alice,
    )
    assert r.status_code == 200, r.text
    assert r.json()["name"] == "Deck"
    assert [m["character"]["name"] for m in r.json()["members"]] == ["Pip", "Vela"]

    chats = (await client.get(f"{API}/chats", headers=alice)).json()
    assert any(ch["room_name"] == "Deck" for ch in chats)

    assert (await client.delete(f"{API}/rooms/{room['id']}", headers=alice)).status_code == 204
    assert (await client.get(f"{API}/chats/{chat_id}", headers=alice)).status_code == 404


async def test_room_validation_and_privacy(client, alice):
    bob, _ = await register(client, "bob")
    a = await make_character(client, alice)
    secret = await make_character(client, bob, name="Secret", visibility="private")
    r = await client.post(
        f"{API}/rooms", json={"name": "Solo", "character_ids": [a["id"]]}, headers=alice
    )
    assert r.status_code in (400, 422)
    r = await client.post(
        f"{API}/rooms",
        json={"name": "Sneaky", "character_ids": [a["id"], secret["id"]]},
        headers=alice,
    )
    assert r.status_code == 404
    pub = await make_character(client, bob, name="Public")
    room = (
        await client.post(
            f"{API}/rooms",
            json={"name": "Mix", "character_ids": [a["id"], pub["id"]]},
            headers=alice,
        )
    ).json()
    assert (await client.get(f"{API}/rooms/{room['id']}", headers=bob)).status_code == 404
    assert (await client.get(f"{API}/chats/{room['chat_id']}", headers=bob)).status_code == 404


# ---------- cards ----------
V2 = {
    "spec": "chara_card_v2",
    "spec_version": "2.0",
    "data": {
        "name": "Mirelle",
        "description": "A lighthouse keeper.",
        "personality": "patient, dry humour",
        "scenario": "A storm night.",
        "first_mes": "*lights the lamp* Evening, {{user}}.",
        "mes_example": "<START>\n{{user}}: Hi\n{{char}}: Mind the steps.",
        "creator_notes": "Cozy coastal character.\nMore notes.",
        "system_prompt": "Stay in character.",
        "alternate_greetings": ["Another greeting"],
        "character_book": {"entries": [{"keys": ["lamp"], "content": "Old lamp."}]},
        "tags": ["Cozy", "coastal", "cozy"],
        "creator": "someone",
        "character_version": "1.2",
        "extensions": {"talkativeness": "0.5", "depth_prompt": {"prompt": "x", "depth": 4}},
    },
}


def _png_with(chunk: dict, key: str = "chara") -> bytes:
    img = Image.new("RGB", (64, 96), (200, 80, 60))
    info = PngImagePlugin.PngInfo()
    info.add_text(key, base64.b64encode(json.dumps(chunk).encode()).decode())
    out = io.BytesIO()
    img.save(out, "PNG", pnginfo=info)
    return out.getvalue()


async def _upload(client, headers, name, data, mime):
    return await client.post(
        f"{API}/characters/import", files={"file": (name, data, mime)}, headers=headers
    )


async def test_import_v2_json_and_round_trip(client, alice):
    r = await _upload(client, alice, "m.json", json.dumps(V2).encode(), "application/json")
    assert r.status_code == 201, r.text
    c = r.json()
    assert c["name"] == "Mirelle" and c["visibility"] == "private"
    assert c["greeting"].startswith("*lights the lamp*")
    assert c["definition"].startswith("<START>")
    assert c["tagline"] == "Cozy coastal character."
    assert c["tags"] == ["cozy", "coastal"]
    assert c["creator_credit"] == "someone"

    out = (await client.get(f"{API}/characters/{c['id']}/card", headers=alice)).json()
    assert out["spec"] == "chara_card_v2"
    d = out["data"]
    for k in ("system_prompt", "alternate_greetings", "character_book", "character_version"):
        assert d[k] == V2["data"][k], k
    assert d["extensions"]["depth_prompt"] == V2["data"]["extensions"]["depth_prompt"]
    assert d["first_mes"] == V2["data"]["first_mes"]
    assert d["creator_notes"] == V2["data"]["creator_notes"]

    # Re-importing our own export gives the same character.
    r = await _upload(client, alice, "again.json", json.dumps(out).encode(), "application/json")
    again = r.json()
    for k in ("name", "tagline", "description", "greeting", "definition", "tags"):
        assert again[k] == c[k], k


async def test_png_export_import(client, alice):
    r = await _upload(client, alice, "m.png", _png_with(V2), "image/png")
    assert r.status_code == 201, r.text
    c = r.json()
    assert c["avatar_url"] and c["avatar_url"].startswith("/media/")

    r = await client.get(f"{API}/characters/{c['id']}/card.png", headers=alice)
    assert r.status_code == 200 and r.headers["content-type"] == "image/png"
    img = Image.open(io.BytesIO(r.content))
    card = json.loads(base64.b64decode(img.text["chara"]))
    assert card["data"]["name"] == "Mirelle"
    assert img.size == (64, 96)

    r = await _upload(client, alice, "back.png", r.content, "image/png")
    assert r.status_code == 201 and r.json()["name"] == "Mirelle"


async def test_import_v1_and_v3_and_bad_input(client, alice):
    v1 = {
        "name": "Old",
        "description": "d",
        "first_mes": "hey",
        "mes_example": "",
        "personality": "",
    }
    r = await _upload(client, alice, "v1.json", json.dumps(v1).encode(), "application/json")
    assert r.status_code == 201 and r.json()["greeting"] == "hey"

    v3 = {"spec": "chara_card_v3", "spec_version": "3.0", "data": {**V2["data"], "name": "Three"}}
    r = await _upload(client, alice, "v3.png", _png_with(v3, "ccv3"), "image/png")
    assert r.status_code == 201 and r.json()["name"] == "Three"

    assert (await _upload(client, alice, "x.json", b"{nope", "application/json")).status_code == 400
    assert (
        await _upload(client, alice, "x.json", b'{"spec":"chara_card_v2","data":{}}', "text/plain")
    ).status_code == 400
    plain = io.BytesIO()
    Image.new("RGB", (8, 8)).save(plain, "PNG")
    assert (await _upload(client, alice, "p.png", plain.getvalue(), "image/png")).status_code == 400


async def test_export_only_by_creator_and_filter_on_import(client, alice):
    bob, _ = await register(client, "bob")
    c = await make_character(client, alice)
    assert (await client.get(f"{API}/characters/{c['id']}/card", headers=bob)).status_code == 403
    assert (
        await client.get(f"{API}/characters/{c['id']}/card.png", headers=bob)
    ).status_code == 403
    long = {**V2, "data": {**V2["data"], "name": "N" * 500, "description": "x" * 50_000}}
    r = await _upload(client, alice, "l.json", json.dumps(long).encode(), "application/json")
    assert r.status_code == 201
    assert len(r.json()["name"]) == 64 and len(r.json()["description"]) == 20_000


async def test_manual_room_waits_for_pick(client, alice):
    a = await make_character(client, alice, name="Vela")
    b = await make_character(client, alice, name="Orrin")
    room = (
        await client.post(
            f"{API}/rooms",
            json={"name": "M", "character_ids": [a["id"], b["id"]], "turn_mode": "manual"},
            headers=alice,
        )
    ).json()
    r = await client.post(
        f"{API}/chats/{room['chat_id']}/messages", json={"content": "Hello all"}, headers=alice
    )
    types = [e["type"] for e in sse_events(r.text)]
    assert types == ["user_message", "stopped"]
    r = await client.post(
        f"{API}/chats/{room['chat_id']}/next?character_id={b['id']}", headers=alice
    )
    done = [e for e in sse_events(r.text) if e["type"] == "done"]
    assert done[0]["message"]["character_id"] == b["id"]
