# Development

## Prerequisites

- [uv](https://docs.astral.sh/uv/) (installs Python 3.12 for you)
- Node.js 22+ and pnpm (`corepack enable`)
- ffmpeg (optional; audio conversion for voices and dictation)

## Run it

```bash
pnpm install
cd apps/server && uv sync
LLM_PROVIDER=mock TTS_PROVIDER=mock STT_PROVIDER=mock \
  SECRET_KEY=dev-secret-key-change-me ENVIRONMENT=development \
  uv run persona serve --reload            # http://127.0.0.1:8000/api/docs

cd apps/web && pnpm dev                    # http://localhost:5173 (proxies /api to :8000)
```

The `mock` providers make the whole app usable without any models: canned chat replies,
placeholder avatars, tone "voices" and fixed transcripts. Switch to real providers in
Admin → Providers.

Optional extras: `uv sync --extra tts --extra stt` for in-process Kokoro and faster-whisper,
`--extra postgres`, `--extra redis`.

## Tests

```bash
cd apps/server && uv run pytest            # unit + API + WebSocket tests
cd apps/web && pnpm test:e2e               # Playwright smoke test (desktop + mobile)
```

Provider adapters are tested against `httpx.MockTransport`
(`persona.services.http.TRANSPORT`, `persona.services.llm.base.TRANSPORT`).

## Database migrations

```bash
cd apps/server
uv run persona makemigration "add something"
uv run persona migrate
```

## Useful commands

```bash
uv run persona seed-demo        # sample characters
uv run persona create-admin me  # create or promote an admin
uv run persona doctor           # provider and system checks
uv run persona backup --out x.tar.gz
uv run persona worker           # background jobs (or rely on EMBEDDED_WORKER)
```

## Docker image

```bash
docker build -f deploy/Dockerfile -t persona-server:dev .
docker build -f deploy/Dockerfile --build-arg EXTRAS="tts stt" -t persona-server:voice .
```
