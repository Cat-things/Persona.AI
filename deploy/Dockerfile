# syntax=docker/dockerfile:1.7
# Persona.AI server image (API + worker + built web app). Build from the repo root:
#   docker build -f deploy/Dockerfile -t persona-server .
# Voice extras (in-process Kokoro TTS + faster-whisper STT) are optional:
#   docker build -f deploy/Dockerfile --build-arg EXTRAS="tts stt" -t persona-server:voice .

FROM node:22-alpine AS web
WORKDIR /src
RUN corepack enable
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/shared/package.json packages/shared/
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile --filter "@persona/web..." 
COPY packages/shared packages/shared
COPY apps/web apps/web
RUN pnpm --filter @persona/web build

FROM python:3.12-slim AS server
ARG EXTRAS=""
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PROJECT_ENVIRONMENT=/app/.venv
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg ca-certificates \
 && rm -rf /var/lib/apt/lists/*
COPY --from=ghcr.io/astral-sh/uv:0.11 /uv /usr/local/bin/uv
WORKDIR /app
COPY apps/server/pyproject.toml apps/server/uv.lock ./
RUN extras="--extra postgres --extra redis"; \
    for e in $EXTRAS; do extras="$extras --extra $e"; done; \
    uv sync --frozen --no-dev --no-install-project $extras
COPY apps/server/persona ./persona
RUN extras="--extra postgres --extra redis"; \
    for e in $EXTRAS; do extras="$extras --extra $e"; done; \
    uv sync --frozen --no-dev $extras
COPY --from=web /src/apps/web/dist /app/web

RUN useradd --system --uid 10001 --home /data persona && mkdir -p /data && chown persona /data
ENV PATH=/app/.venv/bin:$PATH \
    WEB_DIST=/app/web \
    DATA_DIR=/data \
    HOST=0.0.0.0 \
    PORT=8000
USER persona
VOLUME /data
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD python -c "import urllib.request,sys; urllib.request.urlopen('http://127.0.0.1:8000/api/v1/health', timeout=4)" || exit 1
CMD ["persona", "serve"]
