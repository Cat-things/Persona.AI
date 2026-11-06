"""Avatar generation job: prompt -> N images saved as media, owner notified."""

from __future__ import annotations

import logging
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from persona.models import Job, Media
from persona.services import content_filter, settings_store, storage
from persona.services.http import ProviderError
from persona.services.imagegen.providers import ImageRequest, generate, styled
from persona.services.jobs import handler
from persona.services.llm.base import LLMError, complete, resolve_target

log = logging.getLogger("persona.imagegen")
MAX_PROMPT = 1500


def heuristic_prompt(name: str, tagline: str, description: str) -> str:
    desc = " ".join(description.split())[:400]
    parts = [p for p in (name, tagline, desc) if p]
    return ", ".join(parts)


async def suggest_prompt(db: AsyncSession, name: str, tagline: str, description: str) -> str:
    """Ask the LLM for a concise visual description; fall back to a heuristic."""
    cfg = await settings_store.load(db)
    base = heuristic_prompt(name, tagline, description)
    if not (name or description):
        return base
    target = resolve_target(cfg)
    target.max_response_tokens = 120
    msgs = [
        {
            "role": "system",
            "content": "You write prompts for an image model that draws character avatars. "
            "Given a character, reply with ONE line (max 60 words) describing only what is "
            "visible: apparent age range (adult), build, face, hair, clothing, expression, "
            "setting or background, and colors. No names, no story, no quotes.",
        },
        {
            "role": "user",
            "content": f"Name: {name}\nTagline: {tagline}\nDescription: {description[:2000]}",
        },
    ]
    try:
        text = (await complete(target, msgs)).strip().strip('"').splitlines()[0]
    except (LLMError, IndexError):
        return base
    return text[:MAX_PROMPT] if len(text) > 10 else base


@handler("avatar")
async def avatar_job(db: AsyncSession, job: Job) -> dict[str, Any]:
    cfg = await settings_store.load(db, fresh=True)
    p = job.payload
    prompt, negative = styled(p["prompt"], p.get("style"), p.get("negative", ""))
    if content_filter.check(prompt, {**cfg, "content_filter": True}).blocked:
        raise ProviderError("That prompt isn't allowed on this instance.")
    req = ImageRequest(prompt=prompt, negative=negative, n=int(p.get("n", 4)))
    images = await generate(cfg, req)
    urls = []
    for data in images[:4]:
        rel, size = storage.save_image_bytes(data, subdir="generated", max_side=768)
        db.add(Media(owner_id=job.user_id, kind="image", path=rel, mime="image/webp", size=size))
        urls.append(storage.media_url(rel))
    await db.commit()
    return {"images": urls, "prompt": p["prompt"], "style": p.get("style")}
