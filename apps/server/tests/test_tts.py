from __future__ import annotations

import json
import math
import struct

import httpx
import pytest

from persona.services import audio
from persona.services import http as phttp
from persona.services.tts import registry
from tests.conftest import make_character, register, sse_events


def wav_bytes(seconds=6.0, rate=16000) -> bytes:
    n = int(seconds * rate)
    pcm = b"".join(struct.pack("<h", int(3000 * math.sin(i / 8))) for i in range(n))
    return audio.pcm16_to_wav(pcm, rate)


def test_speakable_and_sentences():
    assert (
        audio.speakable("*waves* Hello there! *grins* See https://x.y ok")
        == "Hello there! See link ok"
    )
    done, rest = audio.split_sentences("Hi there. How are you? I am")
    assert done == ["Hi there.", "How are you?"] and rest == "I am"
    done, rest = audio.split_sentences("Wait...")
    assert done == [] and rest == "Wait..."  # could still be growing
    long = "word " * 80
    done, rest = audio.split_sentences(long)
    assert done and len(done[0]) <= 205


def test_resample():
    pcm = struct.pack("<4h", 0, 100, 200, 300)
    assert len(audio.resample_pcm16(pcm, 16000, 8000)) == 4


async def test_voice_library_preview_and_message_tts(client, admin, alice):
    caps = (await client.get("/api/v1/capabilities", headers=alice)).json()
    assert caps["tts"] is False
    await client.patch("/api/v1/admin/settings", json={"tts_provider": "mock"}, headers=admin)
    voices = (await client.get("/api/v1/voices", headers=alice)).json()
    assert {v["name"] for v in voices} == {"Low", "High"}
    low = next(v for v in voices if v["name"] == "Low")

    r = await client.post(f"/api/v1/voices/{low['id']}/preview", headers=alice, json={})
    assert r.status_code == 200 and r.headers["content-type"] in ("audio/mpeg", "audio/wav")

    c = await make_character(client, alice, voice_id=low["id"])
    assert c["voice"]["name"] == "Low"
    chat = (
        await client.post("/api/v1/chats", json={"character_id": c["id"]}, headers=alice)
    ).json()
    evs = sse_events(
        (
            await client.post(
                f"/api/v1/chats/{chat['id']}/messages", json={"content": "hi"}, headers=alice
            )
        ).text
    )
    mid = evs[-1]["message"]["id"]
    r1 = await client.post(f"/api/v1/messages/{mid}/tts", headers=alice)
    assert r1.status_code == 200 and len(r1.content) > 1000
    r2 = await client.post(f"/api/v1/messages/{mid}/tts", headers=alice)
    assert r2.content == r1.content  # cached
    r3 = await client.get(f"/api/v1/messages/{mid}/tts", headers=alice)  # native players
    assert r3.status_code == 200 and r3.content == r1.content

    bob, _ = await register(client, "bob")
    assert (await client.post(f"/api/v1/messages/{mid}/tts", headers=bob)).status_code == 404
    assert (await client.get(f"/api/v1/messages/{mid}/tts", headers=bob)).status_code == 404


async def test_action_only_message_is_rejected(client, admin, alice):
    await client.patch("/api/v1/admin/settings", json={"tts_provider": "mock"}, headers=admin)
    c = await make_character(client, alice, greeting="*nods silently*")
    chat = (
        await client.post("/api/v1/chats", json={"character_id": c["id"]}, headers=alice)
    ).json()
    msgs = (await client.get(f"/api/v1/chats/{chat['id']}", headers=alice)).json()["messages"]
    r = await client.post(f"/api/v1/messages/{msgs[0]['id']}/tts", headers=alice)
    assert r.status_code == 502 and "Nothing to read" in r.json()["detail"]


async def test_clone_requires_rights_and_is_private(client, admin, alice):
    await client.patch("/api/v1/admin/settings", json={"tts_provider": "mock"}, headers=admin)
    files = {"file": ("me.wav", wav_bytes(), "audio/wav")}
    r = await client.post(
        "/api/v1/voices/clone",
        headers=alice,
        files=files,
        data={"name": "My voice", "rights_confirmed": "false"},
    )
    assert r.status_code == 400
    r = await client.post(
        "/api/v1/voices/clone",
        headers=alice,
        files=files,
        data={"name": "My voice", "rights_confirmed": "true"},
    )
    assert r.status_code == 201, r.text
    vid = r.json()["id"]
    assert r.json()["is_public"] is False
    bob, _ = await register(client, "bob")
    names_bob = {v["name"] for v in (await client.get("/api/v1/voices", headers=bob)).json()}
    assert "My voice" not in names_bob
    # bob can't use alice's private voice on his character
    r = await client.post("/api/v1/characters", headers=bob, json={"name": "X", "voice_id": vid})
    assert r.status_code == 400
    short = {"file": ("s.wav", wav_bytes(1.0), "audio/wav")}
    r = await client.post(
        "/api/v1/voices/clone",
        headers=alice,
        files=short,
        data={"name": "Short", "rights_confirmed": "true"},
    )
    assert r.status_code == 400
    assert (await client.delete(f"/api/v1/voices/{vid}", headers=alice)).status_code == 204


async def test_clone_unsupported_provider(client, admin, alice):
    await client.patch("/api/v1/admin/settings", json={"tts_provider": "openai"}, headers=admin)
    r = await client.post(
        "/api/v1/voices/clone",
        headers=alice,
        files={"file": ("me.wav", wav_bytes(), "audio/wav")},
        data={"name": "x", "rights_confirmed": "true"},
    )
    assert r.status_code == 409


@pytest.fixture
def fake_http(monkeypatch):
    def install(handler):
        seen = []

        def wrapped(req):
            seen.append(req)
            return handler(req)

        monkeypatch.setattr(phttp, "TRANSPORT", httpx.MockTransport(wrapped))
        return seen

    return install


async def test_openai_compatible_speech_and_voices(fake_http):
    def handler(r: httpx.Request):
        if r.url.path.endswith("/audio/voices"):
            return httpx.Response(200, json={"voices": ["af_heart", "bm_george"]})
        body = json.loads(r.content)
        assert body["voice"] == "af_heart" and body["response_format"] == "pcm"
        return httpx.Response(200, content=b"\x00\x01" * 2400)

    fake_http(handler)
    cfg = {"tts_provider": "openai", "tts_base_url": "http://kokoro:8880/v1"}
    voices = await registry.list_voices(cfg)
    assert [(v.id, v.gender, v.language) for v in voices] == [
        ("af_heart", "female", "en-us"),
        ("bm_george", "male", "en-gb"),
    ]
    sp = await registry.speak(cfg, registry.VoiceRef("af_heart"), "Hello")
    assert sp.rate == 24000 and len(sp.pcm) == 4800


async def test_elevenlabs(fake_http):
    def handler(r: httpx.Request):
        assert r.headers["xi-api-key"] == "el"
        if r.url.path == "/v1/voices":
            return httpx.Response(
                200,
                json={
                    "voices": [{"voice_id": "v1", "name": "Rachel", "labels": {"gender": "female"}}]
                },
            )
        assert r.url.params["output_format"] == "pcm_24000"
        return httpx.Response(200, content=b"\x00\x00" * 100)

    fake_http(handler)
    cfg = {"tts_provider": "elevenlabs", "tts_api_key": "el"}
    assert (await registry.list_voices(cfg))[0].name == "Rachel"
    sp = await registry.speak(cfg, registry.VoiceRef("v1"), "Hi")
    assert sp.rate == 24000


async def test_xtts_speak_with_latents(fake_http):
    import base64

    wav = audio.pcm16_to_wav(b"\x00\x00" * 240, 24000)

    def handler(r: httpx.Request):
        body = json.loads(r.content)
        assert body["speaker_embedding"] == [1] and body["text"] == "Hi"
        return httpx.Response(200, json=base64.b64encode(wav).decode())

    fake_http(handler)
    ref = registry.VoiceRef(
        "custom", extra={"latents": {"speaker_embedding": [1], "gpt_cond_latent": [[2]]}}
    )
    sp = await registry.speak({"tts_provider": "xtts", "tts_base_url": "http://x"}, ref, "Hi")
    assert sp.rate == 24000 and len(sp.pcm) == 480
