"""Prompt budgeting and rolling summarization."""

from __future__ import annotations

from persona.services import tokens
from persona.services.prompt import (
    CharacterSpec,
    PromptInput,
    Turn,
    build,
    clean_reply,
    split_examples,
)
from tests.conftest import make_character, sse_events


def _turns(n: int, size: int = 200) -> list[Turn]:
    return [
        Turn(role="user" if i % 2 else "assistant", text=f"m{i} " + "x" * size, position=i)
        for i in range(n)
    ]


def test_budget_respected_and_newest_kept():
    p = PromptInput(
        character=CharacterSpec(name="Vela", description="A captain."),
        user_name="Sam",
        history=_turns(200),
        context_tokens=4096,
        response_tokens=512,
    )
    r = build(p)
    assert r.tokens <= r.budget + 8
    assert r.messages[-1]["content"].startswith("m199")
    assert 0 < r.history_included < 200
    assert r.first_included_position == 200 - r.history_included


def test_everything_fits_small_chat():
    p = PromptInput(character=CharacterSpec(name="Vela"), user_name="Sam", history=_turns(4, 10))
    r = build(p)
    assert r.history_included == 4 and r.first_included_position == 0


def test_bigger_context_includes_more():
    base = dict(character=CharacterSpec(name="V"), user_name="S", history=_turns(300))
    small = build(PromptInput(**base, context_tokens=4096))
    big = build(PromptInput(**base, context_tokens=32768))
    assert big.history_included > small.history_included


def test_pinned_and_summary_priority():
    pinned = [f"fact {i} " + "y" * 100 for i in range(100)]
    p = PromptInput(
        character=CharacterSpec(name="V"),
        user_name="S",
        pinned=pinned,
        summary="They met on Mars. " * 400,
        history=_turns(50),
        context_tokens=4096,
    )
    r = build(p)
    system = r.messages[0]["content"]
    assert "fact 0" in system  # newest pinned first
    assert "fact 99" not in system  # capped by pinned share
    assert "[Story so far]" in system
    # summary is capped to its share
    assert tokens.count(system) < r.budget * 0.75
    assert r.history_included >= 1


def test_examples_dropped_first_under_pressure():
    definition = "\n<START>\n".join(
        f"{{{{user}}}}: q{i}\n{{{{char}}}}: a{i} " + "z" * 300 for i in range(6)
    )
    roomy = build(
        PromptInput(
            character=CharacterSpec(name="V", definition=definition),
            user_name="S",
            history=_turns(2, 10),
            context_tokens=16384,
        )
    )
    tight = build(
        PromptInput(
            character=CharacterSpec(name="V", definition=definition),
            user_name="S",
            history=_turns(400),
            context_tokens=4096,
        )
    )
    assert roomy.dropped_examples < tight.dropped_examples
    assert "q0" in tight.messages[0]["content"]  # first example always kept
    assert "S: q0" in tight.messages[0]["content"]  # macros expanded


def test_split_examples_and_clean_reply():
    assert split_examples("a\n<START>\nb\n<start>\nc") == ["a", "b", "c"]
    assert clean_reply("Vela: Hello\nSam: hi back", "Vela", "Sam") == "Hello"
    assert clean_reply("*waves* Hi", "Vela", "Sam") == "*waves* Hi"


def test_room_prompt_roles():
    p = PromptInput(
        character=CharacterSpec(name="Ana"),
        user_name="Sam",
        history=[
            Turn("user", "hi all", 0, "Sam"),
            Turn("assistant", "hello", 1, "Bo", "bo"),
            Turn("assistant", "hey", 2, "Ana", "ana"),
        ],
        room_members=["Ana", "Bo"],
        speaker_id="ana",
    )
    r = build(p)
    assert r.messages[1] == {"role": "user", "content": "Sam: hi all"}
    assert r.messages[2] == {"role": "user", "content": "Bo: hello"}
    assert r.messages[3] == {"role": "assistant", "content": "hey"}
    assert "group chat" in r.messages[0]["content"]


async def test_rolling_summary_triggers(client, admin, alice):
    from persona.services import memory

    await client.patch(
        "/api/v1/admin/settings",
        json={"llm_context_tokens": 1024, "llm_max_response_tokens": 128},
        headers=admin,
    )
    c = await make_character(client, alice)
    chat = (
        await client.post("/api/v1/chats", json={"character_id": c["id"]}, headers=alice)
    ).json()
    for i in range(14):
        r = await client.post(
            f"/api/v1/chats/{chat['id']}/messages",
            json={"content": f"Message {i}: " + "story " * 40},
            headers=alice,
        )
        assert sse_events(r.text)[-1]["type"] == "done"
        await memory.drain()
    mems = (await client.get(f"/api/v1/chats/{chat['id']}/memories", headers=alice)).json()
    summaries = [m for m in mems if m["kind"] == "summary"]
    assert len(summaries) == 1
    assert summaries[0]["content"].startswith("Summary:")

    from persona.db import sessionmaker
    from persona.services.memory import get_summary

    async with sessionmaker()() as db:
        s = await get_summary(db, chat["id"])
        assert s.covers_until > 0
