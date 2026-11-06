from __future__ import annotations

from starlette.testclient import TestClient


def test_chat_websocket_stream_and_stop():
    from persona.main import app

    with TestClient(app) as tc:
        r = tc.post("/api/v1/auth/register", json={"username": "wsuser", "password": "password123"})
        h = {"Authorization": f"Bearer {r.json()['access_token']}"}
        c = tc.post("/api/v1/characters", json={"name": "Echo", "greeting": "Hi"}, headers=h).json()
        chat = tc.post("/api/v1/chats", json={"character_id": c["id"]}, headers=h).json()

        # no/invalid token is rejected
        try:
            with tc.websocket_connect("/api/v1/ws/chat?token=bad") as ws:
                ws.receive_json()
            raise AssertionError("expected close")
        except Exception as e:  # noqa: BLE001
            assert "4401" in repr(e) or "WebSocketDisconnect" in type(e).__name__

        tok = tc.post("/api/v1/auth/ws-token", headers=h).json()["token"]
        with tc.websocket_connect(f"/api/v1/ws/chat?token={tok}") as ws:
            ws.send_json({"type": "ping"})
            assert ws.receive_json() == {"type": "pong"}
            ws.send_json({"type": "send", "chat_id": chat["id"], "content": "Hello socket"})
            types = []
            while True:
                ev = ws.receive_json()
                types.append(ev["type"])
                if ev["type"] in ("done", "error"):
                    break
            assert types[:3] == ["user_message", "typing", "start"]
            assert types[-1] == "done"
            assert "Hello socket" in ev["message"]["candidates"][0]["content"]

            ws.send_json({"type": "send", "chat_id": "nope", "content": "x"})
            assert ws.receive_json()["status"] == 404


def test_stop_keeps_partial_reply(monkeypatch):
    from persona.main import app
    from persona.services.llm import base

    monkeypatch.setattr(base, "MOCK_DELAY", 0.05)
    with TestClient(app) as tc:
        r = tc.post(
            "/api/v1/auth/register", json={"username": "stopper", "password": "password123"}
        )
        h = {"Authorization": f"Bearer {r.json()['access_token']}"}
        c = tc.post("/api/v1/characters", json={"name": "Slow"}, headers=h).json()
        chat = tc.post("/api/v1/chats", json={"character_id": c["id"]}, headers=h).json()
        tok = tc.post("/api/v1/auth/ws-token", headers=h).json()["token"]
        with tc.websocket_connect(f"/api/v1/ws/chat?token={tok}") as ws:
            ws.send_json({"type": "send", "chat_id": chat["id"], "content": "Tell me a long story"})
            deltas = 0
            while deltas < 3:
                ev = ws.receive_json()
                deltas += ev["type"] == "delta"
            ws.send_json({"type": "stop"})
            while ev["type"] != "stopped":
                ev = ws.receive_json()
        msgs = tc.get(f"/api/v1/chats/{chat['id']}", headers=h).json()["messages"]
        reply = msgs[-1]["candidates"][-1]["content"]
        assert msgs[-1]["role"] == "assistant"
        assert 0 < len(reply) < 120  # partial, not the full mock reply
