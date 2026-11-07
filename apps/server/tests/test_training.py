from __future__ import annotations

import json

from persona.db import sessionmaker
from persona.services.training import export, scrub
from tests.conftest import make_character, register, sse_events

API = "/api/v1"


async def _chat_with_ratings(client, headers, ratings, text="Tell me about the ship"):
    c = await make_character(client, headers)
    chat = (
        await client.post(f"{API}/chats", json={"character_id": c["id"]}, headers=headers)
    ).json()
    r = await client.post(
        f"{API}/chats/{chat['id']}/messages", json={"content": text}, headers=headers
    )
    msg = [e for e in sse_events(r.text) if e["type"] == "done"][0]["message"]
    for i, stars in enumerate(ratings):
        if i > 0:
            r = await client.post(
                f"{API}/chats/{chat['id']}/messages/{msg['id']}/regenerate", headers=headers
            )
            msg = [e for e in sse_events(r.text) if e["type"] == "done"][0]["message"]
        cand = msg["candidates"][-1]["id"]
        rr = await client.post(
            f"{API}/candidates/{cand}/rate", json={"rating": stars}, headers=headers
        )
        assert rr.status_code == 200, rr.text
    return chat


async def test_export_requires_opt_in_and_filters(client, alice, tmp_path):
    bob, _ = await register(client, "bob")
    await _chat_with_ratings(client, alice, [4, 1])
    await _chat_with_ratings(client, bob, [4])  # bob never opts in
    await _chat_with_ratings(client, alice, [4], text="my email is a@b.co, call +1 555 123 4567")

    async with sessionmaker()() as db:
        st = await export(db, tmp_path)
    assert st.users == 0 and st.sft_rows == 0

    r = await client.patch(
        f"{API}/me", json={"preferences": {"training_opt_in": True}}, headers=alice
    )
    assert r.json()["preferences"]["training_opt_in"] is True

    # The mock LLM repeats itself on regenerate; make the 1-star swipe actually different.
    async with sessionmaker()() as db:
        from sqlalchemy import update

        from persona.models import MessageCandidate

        await db.execute(
            update(MessageCandidate)
            .where(MessageCandidate.rating == 1)
            .values(content="*shrugs* Whatever.")
        )
        await db.commit()
    async with sessionmaker()() as db:
        st = await export(db, tmp_path)
    assert st.users == 1 and st.sft_rows == 2, st
    rows = [json.loads(x) for x in (tmp_path / "sft.jsonl").read_text().splitlines()]
    body = json.dumps(rows)
    assert "alice" not in body.lower()
    assert "a@b.co" not in body and "555 123" not in body and "[email]" in body
    first = rows[0]["messages"]
    assert first[0]["role"] == "system" and "Captain Vela" in first[0]["content"]
    assert first[1]["role"] == "assistant" and first[1]["weight"] == 0  # greeting
    assert first[-1]["role"] == "assistant" and first[-1]["weight"] == 1

    pairs = [json.loads(x) for x in (tmp_path / "dpo.jsonl").read_text().splitlines()]
    assert len(pairs) == 1
    assert pairs[0]["chosen"][0]["content"] != pairs[0]["rejected"][0]["content"]
    assert pairs[0]["prompt"][-1]["role"] == "user"


async def test_export_drops_filtered_and_low_rated(client, alice, tmp_path):
    await client.patch(f"{API}/me", json={"preferences": {"training_opt_in": True}}, headers=alice)
    await _chat_with_ratings(client, alice, [2])
    await _chat_with_ratings(client, alice, [4], text="the dragon will disembowel him")
    async with sessionmaker()() as db:
        st = await export(db, tmp_path)
    assert st.sft_rows == 0
    assert st.dropped_unrated == 1 and st.dropped_filter == 1


def test_scrub():
    out = scrub("Hi Mira! mail mira@x.io or see https://x.io, Mira.", ["Mira"])
    assert out == "Hi User! mail [email] or see [link] User."


def test_filter_row_public_dataset():
    from persona.services.training import filter_row

    ok = filter_row(
        {"conversations": [{"from": "human", "value": "hi"}, {"from": "gpt", "value": "hello!"}]}
    )
    assert ok == {
        "messages": [
            {"role": "user", "content": "hi", "weight": 0},
            {"role": "assistant", "content": "hello!", "weight": 1},
        ]
    }
    bad = filter_row(
        {
            "messages": [
                {"role": "user", "content": "x"},
                {"role": "assistant", "content": "a 12 year old in sexual acts"},
            ]
        }
    )
    assert bad is None
