"""LLM adapters. Every provider exposes `stream(messages, model, params)` -> text deltas.

Providers:
  openai     any OpenAI-compatible /chat/completions (Ollama, KoboldCpp, LM Studio,
             llama.cpp server, vLLM, OpenRouter, OpenAI, ...)
  anthropic  Anthropic Messages API adapter
  mock       deterministic offline replies (tests, demos, UI development)
"""

from __future__ import annotations

import asyncio
import json
from collections.abc import AsyncIterator
from dataclasses import dataclass, field
from typing import Any

import httpx

ANTHROPIC_URL = "https://api.anthropic.com/v1"
OPENAI_PASSTHROUGH = ("temperature", "top_p", "presence_penalty", "frequency_penalty")
LOCAL_SAMPLER_EXTRAS = ("min_p", "top_k", "repetition_penalty")


class LLMError(RuntimeError):
    pass


@dataclass
class LLMTarget:
    provider: str
    base_url: str
    api_key: str
    model: str
    context_tokens: int
    max_response_tokens: int
    params: dict[str, Any] = field(default_factory=dict)


def resolve_target(
    cfg: dict[str, Any],
    character_model: str | None = None,
    character_params: dict[str, Any] | None = None,
) -> LLMTarget:
    """Pick the model for a chat. Per-character overrides must be in the admin's allowed list."""
    params = dict(character_params or {})
    model = cfg["llm_model"]
    context = int(cfg["llm_context_tokens"])
    base_url, api_key, provider = cfg["llm_base_url"], cfg["llm_api_key"], cfg["llm_provider"]
    if character_model and character_model != model:
        for entry in cfg.get("llm_models") or []:
            e = {"id": entry} if isinstance(entry, str) else dict(entry)
            if e.get("id") == character_model:
                model = character_model
                context = int(e.get("context_tokens") or context)
                provider = e.get("provider") or provider
                # base_url/api_key overrides come only from admin config, never from users
                base_url = e.get("base_url") or base_url
                api_key = e.get("api_key") or api_key
                break
    if "context_tokens" in params:
        context = min(context, int(params.pop("context_tokens")))
    max_resp = int(params.pop("max_tokens", cfg["llm_max_response_tokens"]))
    return LLMTarget(provider, base_url, api_key, model, max(context, 1024), max_resp, params)


async def _sse_lines(resp: httpx.Response) -> AsyncIterator[str]:
    async for line in resp.aiter_lines():
        line = line.strip()
        if line.startswith("data:"):
            yield line[5:].strip()


async def _raise_for(resp: httpx.Response) -> None:
    if resp.status_code >= 400:
        body = (await resp.aread()).decode(errors="replace")[:500]
        raise LLMError(f"LLM endpoint returned {resp.status_code}: {body}")


async def stream_openai(t: LLMTarget, messages: list[dict[str, str]]) -> AsyncIterator[str]:
    body: dict[str, Any] = {
        "model": t.model,
        "messages": messages,
        "stream": True,
        "max_tokens": t.max_response_tokens,
    }
    for k in OPENAI_PASSTHROUGH:
        if k in t.params:
            body[k] = t.params[k]
    is_official = "api.openai.com" in t.base_url
    if not is_official:
        for k in LOCAL_SAMPLER_EXTRAS:
            if k in t.params:
                body[k] = t.params[k]
    headers = {"Authorization": f"Bearer {t.api_key}"} if t.api_key else {}
    if "openrouter.ai" in t.base_url:
        headers["X-Title"] = "Persona.AI"
    url = t.base_url.rstrip("/") + "/chat/completions"
    timeout = httpx.Timeout(connect=10, read=120, write=30, pool=10)
    try:
        async with _client(timeout) as client:
            async with client.stream("POST", url, json=body, headers=headers) as resp:
                await _raise_for(resp)
                async for data in _sse_lines(resp):
                    if data == "[DONE]":
                        break
                    try:
                        chunk = json.loads(data)
                    except json.JSONDecodeError:
                        continue
                    if "error" in chunk:
                        raise LLMError(str(chunk["error"])[:500])
                    choices = chunk.get("choices") or []
                    if not choices:
                        continue
                    delta = choices[0].get("delta") or {}
                    text = delta.get("content")
                    if text:
                        yield text
    except httpx.HTTPError as e:
        raise LLMError(f"Could not reach LLM at {t.base_url}: {type(e).__name__}") from e


def to_anthropic(messages: list[dict[str, str]]) -> tuple[str, list[dict[str, str]]]:
    """System messages -> system string; merge consecutive roles; must start with user."""
    system_parts: list[str] = []
    out: list[dict[str, str]] = []
    for m in messages:
        if m["role"] == "system":
            system_parts.append(m["content"])
            continue
        role = "assistant" if m["role"] == "assistant" else "user"
        if out and out[-1]["role"] == role:
            out[-1]["content"] += "\n\n" + m["content"]
        else:
            out.append({"role": role, "content": m["content"]})
    if not out or out[0]["role"] != "user":
        out.insert(0, {"role": "user", "content": "(The conversation begins.)"})
    return "\n\n".join(system_parts), out


async def stream_anthropic(t: LLMTarget, messages: list[dict[str, str]]) -> AsyncIterator[str]:
    system, msgs = to_anthropic(messages)
    body: dict[str, Any] = {
        "model": t.model,
        "system": system,
        "messages": msgs,
        "max_tokens": t.max_response_tokens,
        "stream": True,
    }
    for k in ("temperature", "top_p", "top_k"):
        if k in t.params:
            body[k] = t.params[k]
    headers = {
        "x-api-key": t.api_key,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
    }
    base = t.base_url if "anthropic" in t.base_url else ANTHROPIC_URL
    timeout = httpx.Timeout(connect=10, read=120, write=30, pool=10)
    try:
        async with _client(timeout) as client:
            async with client.stream(
                "POST", base.rstrip("/") + "/messages", json=body, headers=headers
            ) as resp:
                await _raise_for(resp)
                async for data in _sse_lines(resp):
                    try:
                        ev = json.loads(data)
                    except json.JSONDecodeError:
                        continue
                    if ev.get("type") == "content_block_delta":
                        text = (ev.get("delta") or {}).get("text")
                        if text:
                            yield text
                    elif ev.get("type") == "error":
                        raise LLMError(str(ev.get("error"))[:500])
                    elif ev.get("type") == "message_stop":
                        break
    except httpx.HTTPError as e:
        raise LLMError(f"Could not reach Anthropic API: {type(e).__name__}") from e


MOCK_DELAY = 0.01
# Tests can inject an httpx transport to fake provider endpoints.
TRANSPORT: httpx.AsyncBaseTransport | None = None


def _client(timeout: httpx.Timeout) -> httpx.AsyncClient:
    return httpx.AsyncClient(timeout=timeout, transport=TRANSPORT)


async def stream_mock(t: LLMTarget, messages: list[dict[str, str]]) -> AsyncIterator[str]:
    last_user = next((m["content"] for m in reversed(messages) if m["role"] == "user"), "")
    system = messages[0]["content"] if messages and messages[0]["role"] == "system" else ""
    name = "I"
    if system.startswith("You are "):
        name = system[len("You are ") :].split(".")[0].split(",")[0].strip()
    if "Summarize" in system or "summary" in system.lower()[:200]:
        text = "Summary: " + " ".join(m["content"][:40] for m in messages[1:])[:400]
    else:
        n_swipes = sum(1 for m in messages if m["role"] == "assistant")
        text = (
            f'*{name} considers your words.* You said "{last_user[:120]}". '
            f"That's interesting. Tell me more. (reply {n_swipes})"
        )
    for word in text.split(" "):
        await asyncio.sleep(MOCK_DELAY)
        yield word + " "


async def stream_chat(t: LLMTarget, messages: list[dict[str, str]]) -> AsyncIterator[str]:
    if t.provider == "anthropic":
        gen = stream_anthropic(t, messages)
    elif t.provider == "mock":
        gen = stream_mock(t, messages)
    else:
        gen = stream_openai(t, messages)
    async for piece in gen:
        yield piece


async def complete(t: LLMTarget, messages: list[dict[str, str]]) -> str:
    parts = [p async for p in stream_chat(t, messages)]
    return "".join(parts).strip()


async def list_models(cfg: dict[str, Any]) -> list[str]:
    """Ask an OpenAI-compatible endpoint which models it serves (admin helper)."""
    if cfg["llm_provider"] != "openai":
        return []
    headers = {"Authorization": f"Bearer {cfg['llm_api_key']}"} if cfg["llm_api_key"] else {}
    try:
        async with httpx.AsyncClient(timeout=8) as c:
            r = await c.get(cfg["llm_base_url"].rstrip("/") + "/models", headers=headers)
            r.raise_for_status()
            return sorted(m.get("id", "") for m in r.json().get("data", []) if m.get("id"))
    except (httpx.HTTPError, ValueError):
        return []
