from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from persona.core.deps import DB, CurrentUser, gen_limit
from persona.models import Job
from persona.schemas import JobOut
from persona.services import jobs, settings_store
from persona.services.imagegen import service as _service  # noqa: F401  registers the handler
from persona.services.imagegen.providers import STYLES
from persona.services.imagegen.service import suggest_prompt

router = APIRouter(tags=["images"])


class AvatarIn(BaseModel):
    prompt: str = Field(min_length=3, max_length=1500)
    style: str | None = None
    negative: str = Field(default="", max_length=500)
    character_id: str | None = None


class SuggestIn(BaseModel):
    name: str = Field(default="", max_length=64)
    tagline: str = Field(default="", max_length=140)
    description: str = Field(default="", max_length=20_000)


@router.get("/images/styles")
async def styles(_: CurrentUser) -> list[dict]:
    return [{"id": k, "label": v["label"]} for k, v in STYLES.items()]


@router.get("/images/status")
async def status(db: DB, _: CurrentUser) -> dict:
    cfg = await settings_store.load(db)
    return {"configured": bool(cfg.get("image_provider")), "provider": cfg.get("image_provider")}


@router.post("/images/prompt", dependencies=[gen_limit])
async def prompt_from_character(body: SuggestIn, db: DB, _: CurrentUser) -> dict:
    return {"prompt": await suggest_prompt(db, body.name, body.tagline, body.description)}


@router.post("/images/avatars", response_model=JobOut, status_code=202, dependencies=[gen_limit])
async def generate_avatars(body: AvatarIn, db: DB, user: CurrentUser) -> Job:
    cfg = await settings_store.load(db)
    if not cfg.get("image_provider"):
        raise HTTPException(
            409, "Image generation isn't configured. An admin can set it up in Admin → Providers."
        )
    if body.style and body.style not in STYLES:
        raise HTTPException(400, "Unknown style")
    return await jobs.enqueue(
        db,
        "avatar",
        {
            "prompt": body.prompt.strip(),
            "style": body.style,
            "negative": body.negative,
            "n": 4,
            "character_id": body.character_id,
        },
        user_id=user.id,
    )


@router.get("/jobs/{job_id}", response_model=JobOut)
async def get_job(job_id: str, db: DB, user: CurrentUser) -> Job:
    job = await db.get(Job, job_id)
    if job is None or (job.user_id != user.id and not user.is_admin):
        raise HTTPException(404, "Job not found")
    return job
