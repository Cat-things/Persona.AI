from __future__ import annotations

import base64
import io
import json

import httpx
import pytest
from PIL import Image

from persona.services import http as phttp
from persona.services.http import ProviderError
from persona.services.imagegen import providers as P


def png(color="red") -> bytes:
    b = io.BytesIO()
    Image.new("RGB", (8, 8), color).save(b, "PNG")
    return b.getvalue()


@pytest.fixture
def transport(monkeypatch):
    def install(handler):
        calls = []

        def wrapped(req: httpx.Request):
            calls.append(req)
            return handler(req)

        monkeypatch.setattr(phttp, "TRANSPORT", httpx.MockTransport(wrapped))
        return calls

    return install


async def test_comfyui_flow(transport, monkeypatch):
    monkeypatch.setattr(P.asyncio, "sleep", lambda *_: _noop())
    state = {"polls": 0}

    def handler(r: httpx.Request):
        path = r.url.path
        if path == "/object_info/CheckpointLoaderSimple":
            return httpx.Response(
                200,
                json={
                    "CheckpointLoaderSimple": {
                        "input": {"required": {"ckpt_name": [["dreamshaper.safetensors"]]}}
                    }
                },
            )
        if path == "/prompt":
            wf = json.loads(r.content)["prompt"]
            assert wf["4"]["inputs"]["ckpt_name"] == "dreamshaper.safetensors"
            assert wf["5"]["inputs"]["batch_size"] == 4
            assert "wizard" in wf["6"]["inputs"]["text"]
            return httpx.Response(200, json={"prompt_id": "p1"})
        if path == "/history/p1":
            state["polls"] += 1
            if state["polls"] < 2:
                return httpx.Response(200, json={})
            return httpx.Response(
                200,
                json={
                    "p1": {
                        "status": {"status_str": "success"},
                        "outputs": {
                            "9": {
                                "images": [
                                    {"filename": f"a{i}.png", "subfolder": "", "type": "output"}
                                    for i in range(4)
                                ]
                            }
                        },
                    }
                },
            )
        if path == "/view":
            return httpx.Response(200, content=png())
        return httpx.Response(404)

    transport(handler)
    out = await P.generate(
        {"image_provider": "comfyui", "image_base_url": "http://c:8188"},
        P.ImageRequest(prompt="a wizard"),
    )
    assert len(out) == 4 and out[0].startswith(b"\x89PNG")


async def _noop():
    return None


def test_comfy_custom_workflow_placeholders():
    tpl = json.dumps({"1": {"inputs": {"text": "%prompt%", "seed": "%seed%", "n": "%batch%"}}})
    wf = P.comfy_custom_workflow(tpl, P.ImageRequest(prompt='say "hi"', n=2), 42)
    assert wf["1"]["inputs"] == {"text": 'say "hi"', "seed": 42, "n": 2}


async def test_a1111(transport):
    def handler(r):
        body = json.loads(r.content)
        assert body["batch_size"] == 4 and body["override_settings"]["sd_model_checkpoint"] == "m"
        return httpx.Response(200, json={"images": [base64.b64encode(png()).decode()] * 4})

    transport(handler)
    out = await P.generate(
        {"image_provider": "a1111", "image_model": "m"}, P.ImageRequest(prompt="x")
    )
    assert len(out) == 4


async def test_openai_images(transport):
    def handler(r):
        body = json.loads(r.content)
        assert r.headers["authorization"] == "Bearer sk" and body["n"] == 1
        return httpx.Response(200, json={"data": [{"b64_json": base64.b64encode(png()).decode()}]})

    calls = transport(handler)
    out = await P.generate(
        {"image_provider": "openai", "image_api_key": "sk"}, P.ImageRequest(prompt="x")
    )
    assert len(out) == 4 and len(calls) == 4


async def test_fal(transport):
    def handler(r):
        if r.url.host == "fal.run":
            assert r.headers["authorization"] == "Key k"
            assert json.loads(r.content)["num_images"] == 4
            return httpx.Response(200, json={"images": [{"url": "https://cdn.fal/x.png"}] * 4})
        return httpx.Response(200, content=png())

    transport(handler)
    out = await P.generate(
        {"image_provider": "fal", "image_api_key": "k"}, P.ImageRequest(prompt="x")
    )
    assert len(out) == 4


async def test_not_configured():
    with pytest.raises(ProviderError):
        await P.generate({"image_provider": ""}, P.ImageRequest(prompt="x"))


async def test_avatar_job_end_to_end(client, admin, alice):
    r = await client.post("/api/v1/images/avatars", json={"prompt": "a knight"}, headers=alice)
    assert r.status_code == 409  # not configured yet

    await client.patch("/api/v1/admin/settings", json={"image_provider": "mock"}, headers=admin)
    styles = (await client.get("/api/v1/images/styles", headers=alice)).json()
    assert {"id": "anime", "label": "Anime"} in styles
    r = await client.post(
        "/api/v1/images/avatars", json={"prompt": "a knight", "style": "anime"}, headers=alice
    )
    assert r.status_code == 202
    job = r.json()
    assert job["status"] == "queued"

    from persona.db import sessionmaker
    from persona.services import jobs
    from persona.worker import load_handlers

    load_handlers()
    async with sessionmaker()() as db:
        claimed = await jobs.claim(db)
        assert claimed.id == job["id"]
        await jobs.run_one(db, claimed)

    done = (await client.get(f"/api/v1/jobs/{job['id']}", headers=alice)).json()
    assert done["status"] == "done", done
    assert len(done["result"]["images"]) == 4
    img = await client.get(done["result"]["images"][0])
    assert img.status_code == 200 and img.content[:4] == b"RIFF"

    notes = (await client.get("/api/v1/me/notifications", headers=alice)).json()
    assert notes[0]["kind"] == "job.avatar" and notes[0]["data"]["job_id"] == job["id"]

    # other users can't read the job
    from tests.conftest import register

    bob, _ = await register(client, "bob")
    assert (await client.get(f"/api/v1/jobs/{job['id']}", headers=bob)).status_code == 404


async def test_prompt_suggestion_uses_llm(client, alice):
    r = await client.post(
        "/api/v1/images/prompt",
        headers=alice,
        json={"name": "Vela", "description": "A tall captain with red hair."},
    )
    assert r.status_code == 200 and len(r.json()["prompt"]) > 5
