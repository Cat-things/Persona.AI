# Configuration

Settings come from environment variables (the installer's `.env` / `persona.env`). Provider
settings can also be changed at runtime in **Admin → Providers**; values saved there override the
environment. API keys saved in the admin panel are stored in the database and are never sent back
to browsers (the UI only sees `••••` plus the last four characters).

## Core

| Variable | Default | Purpose |
|---|---|---|
| `SECRET_KEY` | (dev default) | Signs tokens. **Must** be set; the installer generates one. |
| `PUBLIC_URL` | `http://localhost:8000` | Public address; used for CORS, WebSocket origin checks and secure cookies. |
| `HOST` / `PORT` | `127.0.0.1` / `8000` | Bind address. |
| `DATA_DIR` | `./data` | Database, media, models, caches. |
| `DATABASE_URL` | SQLite in `DATA_DIR` | e.g. `postgresql://user:pass@db/persona` (needs the `postgres` extra). |
| `REDIS_URL` | empty | Optional; shared rate limits across processes and instant job wake-ups. |
| `CORS_ORIGINS` | empty | Extra allowed origins, comma separated. |
| `WEB_DIST` | auto | Directory with the built web app to serve at `/`. |
| `EMBEDDED_WORKER` | `true` | Run background jobs inside the API process. The installer sets `false` because it runs `persona worker`. |
| `ENVIRONMENT` | `production` | `development` relaxes the secret-key warning. |

## Accounts and limits

| Variable | Default | Purpose |
|---|---|---|
| `ALLOW_REGISTRATION` | `true` | Open sign-ups (the first account is always allowed and becomes admin). |
| `INVITE_ONLY` | `false` | Require invite codes (create them in Admin → Invites). |
| `ACCESS_TOKEN_MINUTES` | `15` | Access token lifetime. |
| `REFRESH_TOKEN_DAYS` | `30` | Session lifetime (refresh tokens rotate on use). |
| `RL_AUTH_PER_MIN` / `RL_CHAT_PER_MIN` / `RL_GEN_PER_MIN` | `10` / `30` / `10` | Rate limits. |
| `MAX_IMAGE_MB` / `MAX_AUDIO_MB` | `8` / `25` | Upload limits. |
| `CONTENT_FILTER` | `true` | Instance content filter (categories in Admin → Instance). Sexual content involving minors is always blocked. |

## Providers

See [providers.md](providers.md) for setup instructions per backend.

| Variable | Default |
|---|---|
| `LLM_PROVIDER` | `openai` (`openai`, `anthropic`, `mock`) |
| `LLM_BASE_URL` | `http://localhost:11434/v1` |
| `LLM_API_KEY` | empty |
| `LLM_MODEL` | `llama3.1:8b` |
| `LLM_CONTEXT_TOKENS` | `8192` |
| `LLM_MAX_RESPONSE_TOKENS` | `512` |
| `IMAGE_PROVIDER` | empty (`comfyui`, `a1111`, `openai`, `fal`, `mock`) |
| `IMAGE_BASE_URL` / `IMAGE_API_KEY` / `IMAGE_MODEL` | empty |
| `TTS_PROVIDER` | `kokoro` (`piper`, `xtts`, `elevenlabs`, `openai`, `mock`, `none`) |
| `TTS_BASE_URL` / `TTS_API_KEY` / `TTS_MODEL` | empty |
| `KOKORO_MODEL_PATH` / `KOKORO_VOICES_PATH` | auto-downloaded to `DATA_DIR/models/kokoro` |
| `PIPER_BINARY` / `PIPER_VOICES_DIR` | `piper` / `DATA_DIR/models/piper` |
| `STT_PROVIDER` | `faster-whisper` (`openai`, `mock`, `none`) |
| `STT_MODEL` | `small` |
| `STT_DEVICE` | `auto` (`cuda`, `cpu`) |
| `STT_BASE_URL` / `STT_API_KEY` | empty |
