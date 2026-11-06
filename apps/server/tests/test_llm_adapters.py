from __future__ import annotations

import json

import httpx
import pytest

from persona.services.llm import base


def _target(provider="openai", url="http://local/v1"):
    return base.LLMTarget(provider, url, "k", "m", 8192, 100, {"temperature": 0.5, "min_p": 0.1})


@pytest.fixture
def capture(monkeypatch):
    seen = {}

    def install(handler):
        def wrapped(request: httpx.Request):
            seen["url"] = str(request.url)
            seen["headers"] = dict(request.headers)
            seen["body"] = json.loads(request.content)
            return handler(request)

        monkeypatch.setattr(base, "TRANSPORT", httpx.MockTransport(wrapped))
        return seen

    return install


async def test_openai_stream(capture):
    chunks = [
        {"choices": [{"delta": {"content": "Hel"}}]},
        {"choices": [{"delta": {"content": "lo"}}]},
        {"choices": []},
    ]
    body = "".join(f"data: {json.dumps(c)}\n\n" for c in chunks) + "data: [DONE]\n\n"
    seen = capture(
        lambda r: httpx.Response(200, text=body, headers={"content-type": "text/event-stream"})
    )
    out = [p async for p in base.stream_chat(_target(), [{"role": "user", "content": "hi"}])]
    assert "".join(out) == "Hello"
    assert seen["url"] == "http://local/v1/chat/completions"
    assert seen["body"]["stream"] is True and seen["body"]["min_p"] == 0.1
    assert seen["headers"]["authorization"] == "Bearer k"


async def test_openai_official_drops_local_samplers(capture):
    seen = capture(lambda r: httpx.Response(200, text="data: [DONE]\n\n"))
    _ = [p async for p in base.stream_chat(_target(url="https://api.openai.com/v1"), [])]
    assert "min_p" not in seen["body"] and seen["body"]["temperature"] == 0.5


async def test_openai_error(capture):
    capture(lambda r: httpx.Response(404, text='{"error":"model not found"}'))
    with pytest.raises(base.LLMError, match="404"):
        _ = [p async for p in base.stream_chat(_target(), [])]


async def test_anthropic_stream(capture):
    evs = [
        {"type": "message_start"},
        {"type": "content_block_delta", "delta": {"type": "text_delta", "text": "Hi "}},
        {"type": "content_block_delta", "delta": {"type": "text_delta", "text": "there"}},
        {"type": "message_stop"},
    ]
    body = "".join(f"event: {e['type']}\ndata: {json.dumps(e)}\n\n" for e in evs)
    seen = capture(lambda r: httpx.Response(200, text=body))
    msgs = [
        {"role": "system", "content": "You are V."},
        {"role": "assistant", "content": "Greetings"},
        {"role": "user", "content": "a"},
        {"role": "user", "content": "b"},
    ]
    out = "".join([p async for p in base.stream_chat(_target("anthropic", ""), msgs)])
    assert out == "Hi there"
    assert seen["url"] == "https://api.anthropic.com/v1/messages"
    assert seen["headers"]["x-api-key"] == "k"
    b = seen["body"]
    assert b["system"] == "You are V."
    assert b["messages"][0]["role"] == "user"  # synthetic opener before the greeting
    assert b["messages"][-1] == {"role": "user", "content": "a\n\nb"}
    assert "min_p" not in b
