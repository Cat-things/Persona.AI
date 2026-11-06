"""Sliding-window rate limiter. In-memory by default, Redis when REDIS_URL is set."""

from __future__ import annotations

import asyncio
import time
from collections import defaultdict, deque

from fastapi import HTTPException, Request, status

from persona.core.config import get_settings


class MemoryLimiter:
    def __init__(self) -> None:
        self._hits: dict[str, deque[float]] = defaultdict(deque)
        self._lock = asyncio.Lock()

    async def hit(self, key: str, limit: int, window: float) -> tuple[bool, float]:
        now = time.monotonic()
        async with self._lock:
            q = self._hits[key]
            while q and q[0] <= now - window:
                q.popleft()
            if len(q) >= limit:
                return False, window - (now - q[0])
            q.append(now)
            if len(self._hits) > 50_000:  # crude memory guard
                for k in list(self._hits)[:10_000]:
                    if not self._hits[k]:
                        del self._hits[k]
            return True, 0.0

    def reset(self) -> None:
        self._hits.clear()


class RedisLimiter:
    def __init__(self, url: str) -> None:
        import redis.asyncio as redis  # optional dependency

        self._r = redis.from_url(url)

    async def hit(self, key: str, limit: int, window: float) -> tuple[bool, float]:
        now = time.time()
        k = f"rl:{key}"
        pipe = self._r.pipeline()
        pipe.zremrangebyscore(k, 0, now - window)
        pipe.zcard(k)
        pipe.zadd(k, {f"{now}": now})
        pipe.expire(k, int(window) + 1)
        _, count, _, _ = await pipe.execute()
        if count >= limit:
            await self._r.zrem(k, f"{now}")
            return False, window
        return True, 0.0

    def reset(self) -> None:  # pragma: no cover
        pass


_limiter: MemoryLimiter | RedisLimiter | None = None


def get_limiter() -> MemoryLimiter | RedisLimiter:
    global _limiter
    if _limiter is None:
        url = get_settings().redis_url
        if url:
            try:
                _limiter = RedisLimiter(url)
            except ImportError:
                _limiter = MemoryLimiter()
        else:
            _limiter = MemoryLimiter()
    return _limiter


def client_ip(request: Request) -> str:
    # Trust X-Forwarded-For only from a local reverse proxy (Caddy on the same host/network).
    peer = request.client.host if request.client else "unknown"
    fwd = request.headers.get("x-forwarded-for")
    if fwd and peer in {"127.0.0.1", "::1"} | _private_proxy_hint(peer):
        return fwd.split(",")[0].strip()
    return peer


def _private_proxy_hint(peer: str) -> set[str]:
    # Docker bridge networks: accept 172.16/12 and 10/8 peers as proxies.
    if peer.startswith("172.") or peer.startswith("10."):
        return {peer}
    return set()


async def enforce(key: str, limit: int, window: float = 60.0) -> None:
    ok, retry = await get_limiter().hit(key, limit, window)
    if not ok:
        raise HTTPException(
            status.HTTP_429_TOO_MANY_REQUESTS,
            "Too many requests, slow down.",
            headers={"Retry-After": str(int(retry) + 1)},
        )


def limit_by_ip(bucket: str, per_min_attr: str):
    async def dep(request: Request) -> None:
        limit = getattr(get_settings(), per_min_attr)
        await enforce(f"{bucket}:ip:{client_ip(request)}", limit)

    return dep
