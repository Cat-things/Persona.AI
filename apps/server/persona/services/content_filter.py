"""Content filter: a system-prompt guard plus a lightweight lexical check.

The lexical layer is deliberately conservative (it catches obvious cases cheaply). The
`minors_sexual` category is always enforced and cannot be disabled by instance admins.
Admins can turn the configurable categories on/off in the admin panel.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

ALWAYS_ON = "minors_sexual"

CATEGORY_LABELS = {
    "sexual_explicit": "Explicit sexual content",
    "graphic_violence": "Graphic violence / gore",
    "self_harm": "Encouraging self-harm or suicide",
}

_MINOR = (
    r"(?:child|children|kid|kids|minor|minors|underage|preteen|pre-teen|toddler|loli|shota|"
    r"(?:[1-9]|1[0-7])[\s-]*(?:yo|y/o|years?[\s-]*old))"
)
_SEXUAL = r"(?:sex|sexual|nude|naked|porn|erotic|genital|orgasm|intercourse|molest|fondl)"

_PATTERNS: dict[str, list[re.Pattern[str]]] = {
    ALWAYS_ON: [
        re.compile(rf"\b{_MINOR}\b[^.!?\n]{{0,80}}\b{_SEXUAL}\w*", re.I),
        re.compile(rf"\b{_SEXUAL}\w*\b[^.!?\n]{{0,80}}\b{_MINOR}\b", re.I),
    ],
    "sexual_explicit": [
        re.compile(
            r"\b(?:cock|cunt|pussy|cum(?:ming|shot)?|blowjob|handjob|dildo|"
            r"penetrat(?:e|es|ed|ing|ion)|clit(?:oris)?|erection)\b",
            re.I,
        ),
    ],
    "graphic_violence": [
        re.compile(
            r"\b(?:disembowel\w*|entrails|eviscerat\w*|decapitat\w*|gore-soaked|"
            r"flay(?:ed|ing)? (?:alive|skin))\b",
            re.I,
        ),
    ],
    "self_harm": [
        re.compile(
            r"\b(?:you should|go|just) (?:kill yourself|kys|end your life|cut yourself)\b", re.I
        ),
        re.compile(r"\bhow (?:to|do i) (?:kill myself|commit suicide)\b", re.I),
    ],
}

GUARD_TEXT = {
    ALWAYS_ON: "Never produce sexual or romantic content involving minors, under any framing.",
    "sexual_explicit": "Keep content non-explicit: fade to black instead of describing sex acts.",
    "graphic_violence": "Avoid graphic gore; describe violence without lingering detail.",
    "self_harm": "Never encourage self-harm or suicide. If the user seems at risk, step out of "
    "character gently and encourage them to reach out to someone they trust or a local crisis line.",
}

BLOCKED_REPLY = "*This reply was hidden by the content filter.*"


@dataclass
class FilterResult:
    blocked: bool
    category: str | None = None


def active_categories(cfg: dict) -> list[str]:
    cats = [ALWAYS_ON]
    if cfg.get("content_filter", True):
        cats += [c for c in cfg.get("filter_categories", []) if c in CATEGORY_LABELS]
    return cats


def check(text: str, cfg: dict) -> FilterResult:
    for cat in active_categories(cfg):
        for pat in _PATTERNS.get(cat, []):
            if pat.search(text):
                return FilterResult(True, cat)
    return FilterResult(False)


def guard_prompt(cfg: dict) -> str:
    return " ".join(GUARD_TEXT[c] for c in active_categories(cfg) if c in GUARD_TEXT)
