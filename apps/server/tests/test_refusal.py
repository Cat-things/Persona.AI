from __future__ import annotations

import pytest

from persona.services.refusal import is_refusal, notice_for
from tests.conftest import make_character, sse_events

API = "/api/v1"


@pytest.mark.parametrize(
    "text",
    [
        "I can't continue this conversation.",
        "I can’t fulfill that request.",
        "I'm sorry, but I can't help with that.",
        "I cannot create content that sexualizes minors.",
        "As an AI, I don't have personal opinions.",
        "I must decline to continue this roleplay.",
        "This request violates my guidelines.",
        "I don't feel comfortable continuing this scene.",
    ],
)
def test_detects_refusals(text):
    assert is_refusal(text)


@pytest.mark.parametrize(
    "text",
    [
        "*grins* I can't help ye find the treasure, landlubber.",
        "I won't let you fall. Hold my hand!",
        "Sorry, I can't make it to the market today, the tide's too high.",
        "*She shakes her head.* I cannot believe you did that.",
        "",
    ],
)
def test_ignores_in_character_lines(text):
    assert not is_refusal(text)


def test_escalation_levels():
    assert notice_for(1).level == "notice" and notice_for(2).level == "notice"
    assert notice_for(3).level == "stop" and notice_for(3).hold_seconds == 5
    assert notice_for(5).hold_seconds == 15
    assert notice_for(50).hold_seconds == 30


async def test_refusals_escalate_across_chats(client, alice, monkeypatch):
    from persona.services.llm import base

    async def refuse(t, messages):
        for w in ["I'm ", "sorry, ", "but ", "I ", "can't ", "continue ", "this ", "conversation."]:
            yield w

    async def normal(t, messages):
        yield "*smiles* Of course, let's sail on."

    c = await make_character(client, alice)

    async def turn(content):
        chat = (
            await client.post(f"{API}/chats", json={"character_id": c["id"]}, headers=alice)
        ).json()
        r = await client.post(
            f"{API}/chats/{chat['id']}/messages", json={"content": content}, headers=alice
        )
        return [e for e in sse_events(r.text) if e["type"] == "done"][0]

    monkeypatch.setattr(base, "stream_mock", normal)
    assert (await turn("hello"))["refusal"] is None

    monkeypatch.setattr(base, "stream_mock", refuse)
    levels = [(await turn("x"))["refusal"] for _ in range(4)]
    assert [n["count"] for n in levels] == [1, 2, 3, 4]
    assert [n["level"] for n in levels] == ["notice", "notice", "stop", "stop"]
    assert [n["hold_seconds"] for n in levels] == [0, 0, 5, 10]

    monkeypatch.setattr(base, "stream_mock", normal)
    assert (await turn("hi again"))["refusal"] is None
