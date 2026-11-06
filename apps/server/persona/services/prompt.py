"""Prompt assembly with token budgeting.

Priority (highest first): system core (character, persona, filter guard) > pinned memories >
rolling summary > first example dialog > recent history (newest first) > remaining examples.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

from persona.services import tokens

SAFETY_MARGIN = 64
PINNED_SHARE = 0.15
SUMMARY_SHARE = 0.15
EXAMPLES_SHARE = 0.20
CORE_SHARE = 0.40


@dataclass
class CharacterSpec:
    name: str
    description: str = ""
    personality: str = ""
    scenario: str = ""
    definition: str = ""
    greeting: str = ""


@dataclass
class Turn:
    role: str  # user | assistant
    text: str
    position: int
    speaker: str = ""  # display name; for rooms, the character's name
    character_id: str | None = None


@dataclass
class PromptInput:
    character: CharacterSpec
    user_name: str
    persona: str = ""
    pinned: list[str] = field(default_factory=list)  # newest first
    summary: str = ""
    history: list[Turn] = field(default_factory=list)  # oldest -> newest
    context_tokens: int = 8192
    response_tokens: int = 512
    guard: str = ""
    room_members: list[str] = field(default_factory=list)  # other character names
    room_topic: str = ""
    speaker_id: str | None = None  # in rooms, which character is replying


@dataclass
class PromptResult:
    messages: list[dict[str, str]]
    tokens: int
    budget: int
    first_included_position: int | None
    dropped_examples: int
    history_included: int


def macros(text: str, char: str, user: str) -> str:
    if not text:
        return ""
    for a, b in (
        ("{{char}}", char),
        ("{{user}}", user),
        ("<BOT>", char),
        ("<USER>", user),
        ("{{Char}}", char),
        ("{{User}}", user),
    ):
        text = text.replace(a, b)
    return text


def split_examples(definition: str) -> list[str]:
    """Split a definition into example-dialog blocks (SillyTavern `<START>` convention).

    Text before the first block that doesn't look like dialog is returned as block 0 with a
    marker so it can be treated as extra description.
    """
    if not definition.strip():
        return []
    parts = re.split(r"(?im)^\s*<START>\s*$", definition)
    return [p.strip() for p in parts if p.strip()]


def _system_core(p: PromptInput, max_tokens: int) -> str:
    c, u = p.character.name, p.user_name
    lines = [f"You are {c}. Stay in character and write {c}'s next reply in this roleplay chat."]
    if p.room_members:
        others = ", ".join(n for n in p.room_members if n != c)
        lines.append(
            f"This is a group chat with {u} and {others}. Only write as {c}; never write lines "
            f"for {u} or the other characters."
        )
        if p.room_topic:
            lines.append(f"Room topic: {macros(p.room_topic, c, u)}")
    else:
        lines.append(f"Never write {u}'s lines or actions.")
    lines.append("Use *asterisks* for actions. Keep replies vivid and reasonably concise.")
    sections = [
        ("Description", p.character.description),
        ("Personality", p.character.personality),
        ("Scenario", p.character.scenario),
    ]
    head = "\n".join(lines)
    persona = f"\n\n[About {u}]\n{macros(p.persona, c, u)}" if p.persona.strip() else ""
    guard = f"\n\n[Rules]\n{p.guard}" if p.guard else ""
    fixed = tokens.count(head + persona + guard)
    body_budget = max(64, max_tokens - fixed)
    body = ""
    for title, text in sections:
        text = macros(text, c, u).strip()
        if text:
            body += f"\n\n[{title}]\n{text}"
    body = tokens.truncate(body, body_budget)
    return head + body + persona + guard


def _turn_message(t: Turn, p: PromptInput) -> dict[str, str]:
    c = p.character.name
    if p.room_members:
        if t.role == "assistant" and t.character_id == p.speaker_id:
            return {"role": "assistant", "content": t.text}
        name = t.speaker or (p.user_name if t.role == "user" else "Someone")
        return {"role": "user", "content": f"{name}: {t.text}"}
    return {"role": t.role, "content": macros(t.text, c, p.user_name)}


def build(p: PromptInput) -> PromptResult:
    c, u = p.character.name, p.user_name
    budget = p.context_tokens - p.response_tokens - SAFETY_MARGIN
    budget = max(budget, 256)

    core = _system_core(p, int(budget * CORE_SHARE))
    used = tokens.count(core) + tokens.MESSAGE_OVERHEAD

    # Pinned memories, newest first, capped.
    pinned_lines: list[str] = []
    pin_budget = int(budget * PINNED_SHARE)
    pin_used = 0
    for m in p.pinned:
        cost = tokens.count(m) + 2
        if pin_used + cost > pin_budget:
            break
        pinned_lines.append(f"- {macros(m, c, u)}")
        pin_used += cost
    pinned_block = ("\n\n[Things to remember]\n" + "\n".join(pinned_lines)) if pinned_lines else ""
    used += pin_used + (6 if pinned_lines else 0)

    summary_block = ""
    if p.summary.strip():
        s = tokens.truncate(macros(p.summary, c, u), int(budget * SUMMARY_SHARE))
        summary_block = f"\n\n[Story so far]\n{s}"
        used += tokens.count(summary_block)

    examples = [macros(e, c, u) for e in split_examples(p.character.definition)]
    ex_budget = int(budget * EXAMPLES_SHARE)
    chosen_examples: list[str] = []
    if examples:
        first = tokens.truncate(examples[0], ex_budget)
        chosen_examples.append(first)
        used += tokens.count(first) + 4

    # History, newest first.
    history_msgs: list[dict[str, str]] = []
    first_pos: int | None = None
    for i, t in enumerate(reversed(p.history)):
        msg = _turn_message(t, p)
        cost = tokens.count_message(msg)
        if used + cost > budget and i > 0:
            break
        if used + cost > budget:  # always keep the latest turn, truncated if needed
            msg["content"] = tokens.truncate(msg["content"], max(32, budget - used - 8))
            cost = tokens.count_message(msg)
        history_msgs.append(msg)
        used += cost
        first_pos = t.position
    history_msgs.reverse()
    all_history_fit = len(history_msgs) == len(p.history)

    # Remaining examples with leftover budget (only when nothing older was dropped).
    dropped = 0
    for e in examples[1:]:
        cost = tokens.count(e) + 4
        if (
            all_history_fit
            and used + cost <= budget
            and sum(tokens.count(x) for x in chosen_examples) + cost <= ex_budget
        ):
            chosen_examples.append(e)
            used += cost
        else:
            dropped += 1

    examples_block = ""
    if chosen_examples:
        examples_block = (
            "\n\n[Example dialog: style reference only, not part of the story]\n"
            + "\n<START>\n".join(chosen_examples)
        )

    system = core + pinned_block + summary_block + examples_block
    messages = [{"role": "system", "content": system}, *history_msgs]
    if p.room_members:
        messages.append(
            {"role": "system", "content": f"Write only {c}'s next message, without a name prefix."}
        )
    total = sum(tokens.count_message(m) for m in messages)
    return PromptResult(
        messages=messages,
        tokens=total,
        budget=budget,
        first_included_position=first_pos,
        dropped_examples=dropped,
        history_included=len(history_msgs),
    )


def clean_reply(text: str, char: str, user: str, others: list[str] | None = None) -> str:
    """Strip a leading 'Name:' prefix and cut off any turn the model wrote for someone else."""
    text = text.strip()
    for name in [char, *(others or [])]:
        prefix = f"{name}:"
        if text.startswith(prefix):
            text = text[len(prefix) :].lstrip()
            break
    stops = [f"\n{user}:", "\n{{user}}:", *(f"\n{o}:" for o in (others or []))]
    cut = min((text.find(s) for s in stops if s in text), default=-1)
    if cut > 0:
        text = text[:cut].rstrip()
    return text
