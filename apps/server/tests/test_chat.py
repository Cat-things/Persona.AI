from __future__ import annotations

from tests.conftest import make_character, register, sse_events


async def _new_chat(client, headers):
    c = await make_character(client, headers)
    r = await client.post("/api/v1/chats", json={"character_id": c["id"]}, headers=headers)
    assert r.status_code == 201, r.text
    return c, r.json()


async def test_chat_flow_greeting_send_stream(client, alice):
    c, chat = await _new_chat(client, alice)
    detail = (await client.get(f"/api/v1/chats/{chat['id']}", headers=alice)).json()
    assert len(detail["messages"]) == 1
    assert detail["messages"][0]["candidates"][0]["content"] == "Welcome aboard, alice."

    r = await client.post(
        f"/api/v1/chats/{chat['id']}/messages", json={"content": "Hello there"}, headers=alice
    )
    assert r.headers["content-type"].startswith("text/event-stream")
    evs = sse_events(r.text)
    types = [e["type"] for e in evs]
    assert types[0] == "user_message" and types[1] == "typing" and types[2] == "start"
    assert "delta" in types and types[-1] == "done"
    streamed = "".join(e["text"] for e in evs if e["type"] == "delta")
    done = evs[-1]["message"]
    assert done["candidates"][0]["content"] == streamed.strip()
    assert "Hello there" in streamed

    detail = (await client.get(f"/api/v1/chats/{chat['id']}", headers=alice)).json()
    assert [m["role"] for m in detail["messages"]] == ["assistant", "user", "assistant"]
    assert [m["position"] for m in detail["messages"]] == [0, 1, 2]

    ch = (await client.get(f"/api/v1/characters/{c['id']}", headers=alice)).json()
    assert ch["interaction_count"] == 1

    chats = (await client.get("/api/v1/chats", headers=alice)).json()
    assert chats[0]["id"] == chat["id"] and chats[0]["character"]["name"] == "Captain Vela"
    assert chats[0]["last_message"]


async def test_swipes_select_and_rate(client, alice):
    _, chat = await _new_chat(client, alice)
    evs = sse_events(
        (
            await client.post(
                f"/api/v1/chats/{chat['id']}/messages", json={"content": "Hi"}, headers=alice
            )
        ).text
    )
    msg = evs[-1]["message"]
    first_cand = msg["candidates"][0]["id"]

    r = await client.post(
        f"/api/v1/chats/{chat['id']}/messages/{msg['id']}/regenerate", headers=alice
    )
    evs = sse_events(r.text)
    assert evs[-1]["type"] == "done"
    msg2 = evs[-1]["message"]
    assert len(msg2["candidates"]) == 2
    assert msg2["selected_candidate_id"] == msg2["candidates"][1]["id"]

    # swipe back
    r = await client.post(
        f"/api/v1/messages/{msg['id']}/select", json={"candidate_id": first_cand}, headers=alice
    )
    assert r.json()["selected_candidate_id"] == first_cand

    r = await client.post(
        f"/api/v1/candidates/{first_cand}/rate", json={"rating": 4}, headers=alice
    )
    assert r.json()["candidates"][0]["rating"] == 4
    r = await client.post(
        f"/api/v1/candidates/{first_cand}/rate", json={"rating": 5}, headers=alice
    )
    assert r.status_code == 422


async def test_regenerate_only_latest(client, alice):
    _, chat = await _new_chat(client, alice)
    detail = (await client.get(f"/api/v1/chats/{chat['id']}", headers=alice)).json()
    greeting_id = detail["messages"][0]["id"]
    await client.post(f"/api/v1/chats/{chat['id']}/messages", json={"content": "Hi"}, headers=alice)
    r = await client.post(
        f"/api/v1/chats/{chat['id']}/messages/{greeting_id}/regenerate", headers=alice
    )
    evs = sse_events(r.text)
    assert evs[-1]["type"] == "error" and evs[-1]["status"] == 400


async def test_edit_delete_and_rewind(client, alice):
    _, chat = await _new_chat(client, alice)
    for t in ("one", "two"):
        await client.post(
            f"/api/v1/chats/{chat['id']}/messages", json={"content": t}, headers=alice
        )
    msgs = (await client.get(f"/api/v1/chats/{chat['id']}", headers=alice)).json()["messages"]
    assert len(msgs) == 5
    bot = msgs[2]
    r = await client.patch(
        f"/api/v1/messages/{bot['id']}", json={"content": "Edited reply"}, headers=alice
    )
    assert r.json()["candidates"][0]["content"] == "Edited reply"
    user_msg = msgs[1]
    r = await client.patch(
        f"/api/v1/messages/{user_msg['id']}", json={"content": "uno"}, headers=alice
    )
    assert r.status_code == 200

    r = await client.delete(f"/api/v1/messages/{msgs[4]['id']}", headers=alice)
    assert r.status_code == 204
    r = await client.delete(f"/api/v1/messages/{msgs[2]['id']}?and_after=true", headers=alice)
    msgs = (await client.get(f"/api/v1/chats/{chat['id']}", headers=alice)).json()["messages"]
    assert [m["candidates"][0]["content"] for m in msgs] == ["Welcome aboard, alice.", "uno"]


async def test_pin_memories(client, alice):
    _, chat = await _new_chat(client, alice)
    msgs = (await client.get(f"/api/v1/chats/{chat['id']}", headers=alice)).json()["messages"]
    r = await client.post(f"/api/v1/messages/{msgs[0]['id']}/pin", headers=alice)
    assert r.json()["kind"] == "pinned"
    r = await client.post(
        f"/api/v1/chats/{chat['id']}/memories",
        json={"content": "My name is Sam and I fear spiders"},
        headers=alice,
    )
    assert r.status_code == 201
    mems = (await client.get(f"/api/v1/chats/{chat['id']}/memories", headers=alice)).json()
    assert len(mems) == 2
    detail = (await client.get(f"/api/v1/chats/{chat['id']}", headers=alice)).json()
    assert detail["messages"][0]["is_pinned"] is True

    # pinned memory makes it into the prompt
    from persona.db import sessionmaker
    from persona.models import Chat, User
    from persona.services import chat_engine

    async with sessionmaker()() as db:
        ch = await db.get(Chat, chat["id"])
        u = await db.get(User, ch.user_id)
        from persona.models import Character

        c = await db.get(Character, ch.character_id)
        _, _, prompt, *_ = await chat_engine.build_prompt(db, ch, u, c)
    assert "fear spiders" in prompt.messages[0]["content"]

    r = await client.delete(f"/api/v1/messages/{msgs[0]['id']}/pin", headers=alice)
    assert r.status_code == 204
    assert (
        len((await client.get(f"/api/v1/chats/{chat['id']}/memories", headers=alice)).json()) == 1
    )


async def test_multiple_threads_and_privacy(client, alice):
    c, chat1 = await _new_chat(client, alice)
    chat2 = (
        await client.post("/api/v1/chats", json={"character_id": c["id"]}, headers=alice)
    ).json()
    threads = (await client.get(f"/api/v1/characters/{c['id']}/chats", headers=alice)).json()
    assert {t["id"] for t in threads} == {chat1["id"], chat2["id"]}
    bob, _ = await register(client, "bob")
    assert (await client.get(f"/api/v1/chats/{chat1['id']}", headers=bob)).status_code == 404
    r = await client.post(
        f"/api/v1/chats/{chat1['id']}/messages", json={"content": "x"}, headers=bob
    )
    assert r.status_code == 404


async def test_llm_error_surfaces(client, alice, monkeypatch):
    from persona.services.llm import base

    async def boom(t, messages):
        raise base.LLMError("Could not reach LLM")
        yield  # pragma: no cover

    monkeypatch.setattr(base, "stream_mock", boom)
    _, chat = await _new_chat(client, alice)
    evs = sse_events(
        (
            await client.post(
                f"/api/v1/chats/{chat['id']}/messages", json={"content": "Hi"}, headers=alice
            )
        ).text
    )
    assert evs[-1]["type"] == "error"
    msgs = (await client.get(f"/api/v1/chats/{chat['id']}", headers=alice)).json()["messages"]
    assert [m["role"] for m in msgs] == ["assistant", "user"]  # empty reply was dropped


async def test_output_filter(client, alice, monkeypatch):
    from persona.services.llm import base

    async def bad(t, messages):
        yield "She grabs his cock and"

    monkeypatch.setattr(base, "stream_mock", bad)
    _, chat = await _new_chat(client, alice)
    evs = sse_events(
        (
            await client.post(
                f"/api/v1/chats/{chat['id']}/messages", json={"content": "Hi"}, headers=alice
            )
        ).text
    )
    assert evs[-1]["filtered"] is True
    assert "hidden by the content filter" in evs[-1]["message"]["candidates"][0]["content"]


async def test_models_endpoint_and_override(client, admin, alice):
    await client.patch(
        "/api/v1/admin/settings",
        json={"llm_models": [{"id": "big-model", "context_tokens": 32000}]},
        headers=admin,
    )
    models = (await client.get("/api/v1/models", headers=alice)).json()
    assert [m["id"] for m in models] == ["llama3.1:8b", "big-model"]

    from persona.services.llm.base import resolve_target

    cfg = {
        "llm_model": "a",
        "llm_context_tokens": 8192,
        "llm_base_url": "u",
        "llm_api_key": "",
        "llm_provider": "openai",
        "llm_max_response_tokens": 300,
        "llm_models": [{"id": "big", "context_tokens": 32000}],
    }
    assert resolve_target(cfg, "big").context_tokens == 32000
    assert resolve_target(cfg, "not-allowed").model == "a"
    t = resolve_target(cfg, None, {"context_tokens": 4096, "max_tokens": 200, "temperature": 0.7})
    assert t.context_tokens == 4096 and t.max_response_tokens == 200
    assert t.params == {"temperature": 0.7}
