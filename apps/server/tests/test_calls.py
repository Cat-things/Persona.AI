from __future__ import annotations

import json
import math
import struct
import time

from starlette.testclient import TestClient

from persona.services.call import chunk_text
from persona.services.vad import FRAME_BYTES, StreamingVAD


def tone(ms: int, amp: int = 8000, rate: int = 16000) -> bytes:
    n = rate * ms // 1000
    return b"".join(
        struct.pack("<h", int(amp * math.sin(2 * math.pi * 220 * i / rate))) for i in range(n)
    )


def silence(ms: int, rate: int = 16000) -> bytes:
    return b"\x00\x00" * (rate * ms // 1000)


def noise(ms: int, amp: int = 60) -> bytes:
    import random

    r = random.Random(1)
    return b"".join(struct.pack("<h", r.randint(-amp, amp)) for _ in range(16 * ms))


def test_vad_detects_utterance():
    v = StreamingVAD()
    evs = v.feed(noise(500)) + v.feed(tone(800)) + v.feed(silence(700))
    kinds = [e.kind for e in evs]
    assert kinds == ["start", "end"]
    utter = evs[-1].audio
    assert len(utter) >= 16000 * 2 * 0.8  # whole utterance incl. pre-roll
    assert len(utter) % 2 == 0


def test_vad_ignores_blips_and_handles_odd_chunks():
    v = StreamingVAD()
    evs = v.feed(tone(100)) + v.feed(silence(800))
    assert [e.kind for e in evs] == ["start", "discard"]
    v = StreamingVAD()
    data = noise(300) + tone(600) + silence(700)
    evs = []
    for i in range(0, len(data), 333):  # not frame-aligned
        evs += v.feed(data[i : i + 333])
    assert [e.kind for e in evs] == ["start", "end"]
    assert FRAME_BYTES == 640


def test_vad_barge_in_needs_sustained_louder_speech():
    v = StreamingVAD()
    v.feed(noise(400))
    v.barge_in = True
    assert v.feed(tone(120)) == []  # too short to interrupt
    v.reset()
    assert [e.kind for e in v.feed(tone(400))] == ["start"]


def test_chunker_first_chunk_early():
    chunks, rest = chunk_text("Well, that is a long story about the sea and", first=True)
    assert chunks == ["Well,"] or chunks == [] or chunks[0].endswith(",")
    chunks, rest = chunk_text("Oh, I suppose the harbour was quieter back then, and", True)
    assert chunks and chunks[0].endswith(",") and rest.startswith("and")
    chunks, rest = chunk_text("Hello there. Next", first=False)
    assert chunks == ["Hello there."] and rest == "Next"


def _setup(tc, name):
    r = tc.post("/api/v1/auth/register", json={"username": name, "password": "password123"})
    h = {"Authorization": f"Bearer {r.json()['access_token']}"}
    if r.json()["user"]["is_admin"]:
        tc.patch(
            "/api/v1/admin/settings",
            headers=h,
            json={"tts_provider": "mock", "stt_provider": "mock"},
        )
    c = tc.post("/api/v1/characters", json={"name": "Caller", "greeting": "Hi"}, headers=h).json()
    chat = tc.post("/api/v1/chats", json={"character_id": c["id"]}, headers=h).json()
    tok = tc.post("/api/v1/auth/ws-token", headers=h).json()["token"]
    return h, chat, tok


def _recv_until(ws, kinds, limit=400):
    """Collect events (JSON) and count audio bytes until one of `kinds` arrives."""
    events, audio_bytes = [], 0
    for _ in range(limit):
        m = ws.receive()
        if m.get("bytes") is not None:
            audio_bytes += len(m["bytes"])
            continue
        ev = json.loads(m["text"])
        events.append(ev)
        if ev["type"] in kinds:
            return events, audio_bytes
    raise AssertionError(f"never got {kinds}: {[e['type'] for e in events]}")


def test_call_end_to_end():
    from persona.main import app

    with TestClient(app) as tc:
        h, chat, tok = _setup(tc, "calladmin")
        with tc.websocket_connect(f"/api/v1/ws/call?token={tok}&chat_id={chat['id']}") as ws:
            evs, _ = _recv_until(ws, {"ready"})
            assert evs[-1]["output_rate"] == 24000
            ws.send_bytes(noise(300) + tone(900) + silence(700))
            evs, audio_bytes = _recv_until(ws, {"bot_done"})
            types = [e["type"] for e in evs]
            assert "user_text" in types and "bot_text_delta" in types and "audio" in types
            user_text = next(e for e in evs if e["type"] == "user_text")["text"]
            assert user_text == "Hello there, how are you today?"
            assert audio_bytes > 24000  # at least half a second of speech
            metrics = next(e for e in evs if e["type"] == "metrics")
            assert metrics["first_audio_ms"] >= 0
            states = [e["state"] for e in evs if e["type"] == "state"]
            assert states[:2] == ["listening", "thinking"] and "speaking" in states
            ws.send_text(json.dumps({"type": "playback_done"}))
            evs, _ = _recv_until(ws, {"state"})
            assert evs[-1]["state"] == "listening"
            ws.send_text(json.dumps({"type": "hangup"}))
        # transcript saved into the chat
        msgs = tc.get(f"/api/v1/chats/{chat['id']}", headers=h).json()["messages"]
        assert [m["role"] for m in msgs][-2:] == ["user", "assistant"]
        assert msgs[-2]["candidates"][0]["content"] == "Hello there, how are you today?"


def test_call_barge_in(monkeypatch):
    from persona.main import app
    from persona.services.llm import base

    monkeypatch.setattr(base, "MOCK_DELAY", 0.08)  # slow reply so we can interrupt it
    with TestClient(app) as tc:
        h, chat, tok = _setup(tc, "bargeadmin")
        with tc.websocket_connect(f"/api/v1/ws/call?token={tok}&chat_id={chat['id']}") as ws:
            _recv_until(ws, {"ready"})
            ws.send_bytes(noise(300) + tone(900) + silence(700))
            _recv_until(ws, {"audio"})  # character started talking
            ws.send_bytes(tone(600))  # user talks over it
            evs, _ = _recv_until(ws, {"interrupt"})
            assert evs[-1]["reason"] == "barge-in"
            ws.send_bytes(silence(800))
            ws.send_text(json.dumps({"type": "hangup"}))
        time.sleep(0.2)
        msgs = tc.get(f"/api/v1/chats/{chat['id']}", headers=h).json()["messages"]
        bot = [m for m in msgs if m["role"] == "assistant"][-1]
        assert bot["candidates"][-1]["content"].endswith("…")  # trimmed to what was heard


def test_call_requires_voice_providers():
    from persona.main import app

    with TestClient(app) as tc:
        r = tc.post("/api/v1/auth/register", json={"username": "nocfg", "password": "password123"})
        h = {"Authorization": f"Bearer {r.json()['access_token']}"}
        c = tc.post("/api/v1/characters", json={"name": "Z"}, headers=h).json()
        chat = tc.post("/api/v1/chats", json={"character_id": c["id"]}, headers=h).json()
        tok = tc.post("/api/v1/auth/ws-token", headers=h).json()["token"]
        with tc.websocket_connect(f"/api/v1/ws/call?token={tok}&chat_id={chat['id']}") as ws:
            ev = json.loads(ws.receive()["text"])
            assert ev["type"] == "error" and ev["fatal"] is True


async def test_stt_upload(client, admin, alice):
    from persona.services import audio

    await client.patch("/api/v1/admin/settings", json={"stt_provider": "mock"}, headers=admin)
    wav = audio.pcm16_to_wav(tone(1000), 16000)
    r = await client.post("/api/v1/stt", headers=alice, files={"file": ("a.wav", wav, "audio/wav")})
    assert r.status_code == 200 and r.json()["text"]
