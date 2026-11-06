"""Shared httpx client factory so tests can inject a MockTransport for provider calls."""

from __future__ import annotations

import httpx

TRANSPORT: httpx.AsyncBaseTransport | None = None


def client(timeout: float | httpx.Timeout = 60.0, **kw) -> httpx.AsyncClient:
    return httpx.AsyncClient(timeout=timeout, transport=TRANSPORT, **kw)


class ProviderError(RuntimeError):
    pass


async def raise_for(resp: httpx.Response, what: str) -> None:
    if resp.status_code >= 400:
        body = resp.text[:400] if not resp.is_stream_consumed else ""
        raise ProviderError(f"{what} returned {resp.status_code}: {body}")
