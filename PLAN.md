# Persona.AI: Build Plan

Self-hostable, open source AI character chat platform. Character chat UX patterns (discover feed,
swipes, ratings, calls, rooms), with original branding, plus a one-command installer.

This file is the source of truth for progress. Each phase ends with tests passing, this file
updated, and a commit.

## Status

| # | Phase | Status |
|---|-------|--------|
| 0 | Plan | done |
| 1 | Backend skeleton, auth, DB, characters CRUD | done |
| 2 | Chat: streaming LLM, swipes, ratings, memory | done |
| 3 | Web frontend: discover, chat, create character | done |
| 4 | Installer (Docker, then native) | done (native mode untested on a real host, see log) |
| 5 | Avatar generation | done |
| 6 | TTS voices + playback | done |
| 7 | Calls (STT + streaming pipeline + barge-in) | done (browser call path not yet run against a real mic) |
| 8 | Group chats, personas, card import/export | pending |
| 9 | Mobile app (Expo) | pending |
| 10 | Windows/macOS installer polish, CI, docs | pending |

## Architecture

```
            ┌──────────── Caddy (optional, auto HTTPS) ────────────┐
            │                                                      │
  Web (PWA, static) ──┐                                            │
  Mobile (Expo)  ─────┼── HTTPS / WSS ──► FastAPI app (uvicorn) ───┘
                      │                    │  REST  /api/v1/*
                      │                    │  WS    /api/v1/ws/chat, /api/v1/ws/call
                      │                    │
                      │                    ├── SQLAlchemy (SQLite default / Postgres)
                      │                    ├── Redis (optional: rate limits, job wakeups)
                      │                    └── Provider adapters (server-side keys only)
                      │                          LLM:   OpenAI-compatible, Anthropic adapter
                      │                          Image: ComfyUI, A1111/Forge, OpenAI, fal.ai
                      │                          TTS:   Kokoro, Piper, XTTS-v2, ElevenLabs
                      │                          STT:   faster-whisper, OpenAI Whisper
                      │
                      └── Worker process (same codebase, `persona worker`)
                            polls the `jobs` table: image gen, TTS pre-render, summarization
```

- One Python package (`persona`) serves the API, the worker, the CLI (`persona migrate`,
  `persona create-admin`, `persona doctor`) and, in production, the built web app as static files.
  A single port is enough for a homelab install.
- Jobs live in the DB (`jobs` table) so no Redis is required. When Redis is configured it is used
  for rate-limit counters and as a wake-up signal for the worker; correctness never depends on it.
- Provider settings live in the `settings` table (admin UI) and fall back to `.env`. Secret
  fields are write-only through the API: reads return `"••••" + last 4`, never the key.

## Folder layout

```
.
├── apps/
│   ├── server/              Python 3.12 FastAPI app (uv project)
│   │   ├── persona/
│   │   │   ├── api/         routers (auth, users, characters, chats, rooms, personas,
│   │   │   │                admin, media, voices, images, calls, ws)
│   │   │   ├── core/        config, security, rate limiting, deps, errors
│   │   │   ├── models/      SQLAlchemy models
│   │   │   ├── schemas/     Pydantic request/response models
│   │   │   ├── services/    llm/, tts/, stt/, imagegen/, prompt.py, memory.py, cards.py,
│   │   │   │                filter.py, jobs.py, storage.py
│   │   │   ├── worker.py
│   │   │   └── cli.py
│   │   ├── alembic/
│   │   └── tests/
│   ├── web/                 React + Vite + TS + Tailwind, PWA
│   └── mobile/              Expo (React Native + TS)
├── packages/
│   └── shared/              TS API types + fetch/WebSocket client, used by web and mobile
├── deploy/                  docker-compose template, Dockerfiles, systemd/launchd units,
│                            Caddyfile template, NSSM helpers
├── install.sh               Linux + macOS installer
├── install.ps1              Windows installer
├── docs/
└── PLAN.md
```

## Data model (core tables)

users, refresh_tokens, invites, characters, character_tags, personas, chats, messages,
message_candidates (swipes), memories (pinned + summaries), rooms, room_members, voices,
media (uploads), jobs, reports, settings, notifications/push_tokens, character_likes.

- A **chat** belongs to a user and either one character (1:1) or a room (group).
- A **message** has N **candidates** (swipes) and a `selected_candidate_id`. Regenerate adds a
  candidate. Ratings (1 to 4 stars) are per candidate. Editing a bot message edits the selected
  candidate's text.
- **Memories**: `kind=pinned` (from a pinned message, or typed by user) and `kind=summary`
  (rolling summary covering messages up to `covers_until_message_id`).

## Prompt assembly and token budgeting

Budget = model context size − reserved response tokens. Fill in priority order:
1. System block: character definition, persona, instance content-filter rules (always kept,
   truncated last-resort).
2. Pinned memories (newest first until their sub-budget, default 15%, is spent).
3. Latest rolling summary.
4. Example dialogs (dropped first under pressure, beyond the first example).
5. Recent messages, newest first, until the budget is full.
When un-summarized history overflows the window, a summarization job folds the oldest
overflowing messages into the rolling summary. Token counting uses a fast heuristic
(chars/3.6, rounded up) with optional `tiktoken` when installed.

## Calls pipeline

Mic (16 kHz PCM16 frames over WS) → VAD (Silero via onnx if available, energy-based fallback)
→ streaming STT (faster-whisper on rolling segments) → LLM stream → sentence chunker →
streaming TTS per sentence → audio frames back over WS. Barge-in: if VAD detects user speech
while the bot is speaking, the server cancels the LLM/TTS tasks and sends `{"type":"interrupt"}`
so the client flushes its playback queue. WebSocket first; WebRTC is a later option.

## Defaults picked (override any of these)

| Topic | Default |
|-------|---------|
| Branding | Name "Persona.AI", mark is a stylised speech bubble with two overlapping faces (original SVG). Accent "Ember" coral `#FF6B4A` + deep indigo surfaces. Fonts: "Outfit" for headings, "Inter" for body, bundled via @fontsource (no CDN, works offline). |
| Python | 3.12, managed by `uv` (installer bootstraps uv). |
| Package names | `persona` (server), `@persona/web`, `@persona/mobile`, `@persona/shared`. |
| API prefix | `/api/v1`. Web served at `/`. |
| Auth | Access JWT 15 min (HS256), refresh token 30 days, rotated on use, stored hashed in DB. Web keeps refresh token in an httpOnly cookie *and* returns it in the body for mobile. |
| Passwords | argon2id via `argon2-cffi`. |
| Registration | Open by default; `INVITE_ONLY=true` switches to invite codes. First user becomes admin. |
| Rate limits | In-memory sliding window (per-process), Redis when `REDIS_URL` set. Auth 10/min/IP, chat 30/min/user, generation 10/min/user. |
| Default LLM | Ollama at `http://localhost:11434/v1`, model `llama3.1:8b` (CPU) or `mistral-nemo:12b` (≥ 12 GB VRAM) chosen by installer. |
| Default TTS | Kokoro (via `kokoro-onnx`), Piper fallback. |
| Default STT | faster-whisper `small` (GPU `int8_float16`, CPU `int8`). |
| Default image gen | None configured; the avatar generator shows setup instructions until an admin configures ComfyUI/A1111/OpenAI/fal. |
| Content filter | On. Blocks sexual content involving minors (always, cannot be disabled), plus configurable categories (explicit sexual, graphic violence, self-harm encouragement) via a keyword/regex layer and a system-prompt guard. Admin can turn off the configurable categories per instance. |
| Storage | Local disk under `DATA_DIR` (`/var/lib/persona` native, volume in Docker). |
| Upload limits | Images 8 MB (png/jpeg/webp, verified by magic bytes, re-encoded with Pillow), audio 25 MB (wav/mp3/ogg/webm/m4a). |
| Docker images | `ghcr.io/cat-things/persona-server` (includes built web), multi-arch amd64 + arm64. |
| Push notifications | Expo push service (opt-in; the server stores Expo push tokens). |
| License | AGPL-3.0 (protects a self-hosted network service). Easy to change to MIT/Apache if preferred. |

## Open questions

1. License: AGPL-3.0 chosen; confirm or switch.
2. Should public characters be visible to logged-out visitors? Default: no, login required.
3. Expo push needs internet access from the server; fully offline instances just won't get push.
4. XTTS-v2 is under the Coqui Public Model License (non-commercial). It is optional and off by
   default; admins enabling it should check the license.

## Progress log

- Phase 0: PLAN.md written.
- Phase 1: FastAPI app factory, async SQLAlchemy (SQLite WAL / Postgres), Alembic (migrations
  live in `persona/migrations`, run automatically by `persona serve`), all core tables, argon2
  auth with rotating refresh tokens + reuse detection, invite-only mode, first-user-admin,
  rate limiting (memory/Redis), characters CRUD + discover (popular/trending/recent/featured,
  search, tags, likes), image upload validation (magic bytes + Pillow re-encode to WebP),
  content filter (always-on minors rule + configurable categories), admin API (stats, users,
  characters, reports, invites, provider settings with masked secrets), DB job queue + worker,
  `persona` CLI (serve, worker, migrate, create-admin, doctor). 20 pytest tests.
- Phase 2: LLM adapters (OpenAI-compatible SSE, Anthropic Messages adapter, `mock` provider
  for demos/tests; per-character model override restricted to the admin's `llm_models` list),
  token-budgeted prompt builder (core > pinned > summary > first example > history > other
  examples), rolling summarization in-process (per-chat lock, chunked for small windows),
  chat engine (greeting, streaming, swipes as candidates, regenerate latest only, edit,
  delete / rewind, 1-4 star ratings, pin to memory, manual memories, multiple threads,
  output content filter, partial reply kept on stop), REST + SSE endpoints and a chat
  WebSocket (`/api/v1/ws/chat`, short-lived ws-token, origin check, stop/cancel).
  Room turn-taking logic is in the engine (UI/API wiring in phase 8). 43 tests.
- Phase 3: `packages/shared` (typed API client with single-flight token refresh, auto-
  reconnecting ChatSocket, formatting helpers), web app (React 19, react-router 8, TanStack
  Query, Tailwind v4, PWA via vite-plugin-pwa). Screens: login/register/first-run setup,
  Discover (greeting, continue-chatting row, featured + trending rails, sort chips, tag chips,
  search, infinite grid), chat (streaming bubbles with caret, typing dots, swipes with
  counter and keyboard arrows, regenerate on swipe-right past the end, 1-4 star rating, edit,
  delete, rewind, pin, report, memory modal, chat threads modal, stop button, drafts saved
  per chat, load older on scroll), character page, character editor (avatar upload, tags,
  visibility, advanced definition/personality/scenario/model/temperature), profile,
  settings, admin (overview + health, providers, instance + content filter, users,
  characters, reports, invites). PRODUCT.md + DESIGN.md capture the design system (Ember
  coral on indigo-tinted dark, Figtree). Playwright smoke test (desktop + mobile).
  Server serves `apps/web/dist` at `/` when built.
- Phase 4: `deploy/Dockerfile` (multi-stage: web build + uv venv, non-root uid 10001,
  optional `EXTRAS="tts stt"`), `deploy/docker-compose.yml` with profiles core / llm /
  image-gen / tts / stt / proxy / redis plus `docker-compose.nvidia.yml` and
  `docker-compose.amd.yml` GPU overlays (selected via COMPOSE_FILE in .env), Caddyfile.
  In Docker mode TTS/STT use the Kokoro-FastAPI and Speaches containers through their
  OpenAI-compatible APIs; native mode runs Kokoro/faster-whisper in-process.
  `install.sh`: interactive menu + flags, OS/distro/arch/GPU/VRAM detection, model
  recommendation from VRAM/RAM, Docker + compose + NVIDIA toolkit setup, native mode
  (system user, uv venv, private Node for the web build, hardened systemd units / launchd
  agents, native Ollama, optional native ComfyUI + DreamShaper 8 checkpoint, Caddy),
  secrets generated into a 600 env file and never printed, idempotent re-runs (secrets and
  edits kept), localhost-only binding unless a domain (Caddy) or `--lan` is given, firewall
  hints, subcommands update / backup / restore / uninstall [--purge] / doctor / status.
  `persona backup|restore` (CLI, streams via stdout/stdin for containers), `persona
  seed-demo`. Tested here: image build, container run, full `install.sh --docker` cycle
  (install, idempotent re-run, doctor, update, backup, restore, uninstall --purge) on
  rootless podman. Not yet exercised on a real host: native mode (needs root + systemd),
  GPU containers, ComfyUI/Kokoro/Speaches profiles, Caddy with a real domain, macOS.
- Phase 5: image providers (ComfyUI with a built-in txt2img workflow or an admin-supplied
  API workflow with %prompt%/%negative%/%seed%/%batch% placeholders and auto checkpoint
  pick, AUTOMATIC1111/Forge, OpenAI-compatible images, fal.ai, offline mock), six style
  presets, LLM-written visual prompt from the character description, `avatar` job (4
  images re-encoded to WebP, owner notified in-app + Expo push), `/jobs/{id}` polling,
  embedded job loop in the API process (`EMBEDDED_WORKER`, off when the installer runs a
  dedicated worker). Web: generator modal (prompt, write-from-description, styles,
  generate 4, pick) and a circular pan/zoom cropper (pointer, wheel, keyboard) exporting
  a 512px square. 53 tests.
- Phase 6: TTS providers behind one interface returning PCM16 (Kokoro in-process with
  auto-downloaded model files, Piper binary, XTTS-v2 streaming server, ElevenLabs,
  OpenAI-compatible speech incl. Kokoro-FastAPI voice listing, mock). Voice library synced
  from the provider, per-character voice, default voice fallback, content-hash audio
  cache (MP3 via ffmpeg, WAV otherwise), `*actions*` stripped before speaking, preview
  endpoint, voice cloning (XTTS latents / ElevenLabs instant clone) gated on an explicit
  rights confirmation, samples stored outside public media, `tts_prerender` job when
  auto-play is on, `/capabilities`. Web: shared single-audio player, play/stop on every
  reply, auto-play toggle (chat header + settings), voice picker with browse/filter/preview
  and clone form. Verified real in-process Kokoro here (54 voices, 2.7 s speech in 1.2 s
  on CPU). 62 tests.
- Phase 7: STT providers (faster-whisper in-process with CUDA/CPU auto + fallback,
  OpenAI-compatible transcription incl. Speaches, mock; Whisper silence hallucinations
  filtered), adaptive energy VAD (pre-roll, min speech, end-of-utterance silence, stricter
  barge-in mode), call session over `/ws/call` (PCM16 16 kHz in, 24 kHz out in 100 ms
  frames): VAD -> STT -> transcript saved as chat messages -> streamed LLM -> sentence
  chunker (first chunk cut early at a comma) -> TTS per sentence while the LLM keeps
  going; live partial transcripts for local STT; barge-in and tap-to-interrupt cancel
  LLM + TTS, flush client playback and trim the saved reply to what was heard; latency
  metrics (stt, first token, first audio). `/stt` upload for dictation. Web: AudioWorklet
  capture + resampler, gapless scheduled playback, call screen (avatar ring reacting to
  speech, timer, live transcript, mute, hang up), composer mic dictation, call button.
  70 server tests incl. end-to-end call and barge-in over a real WebSocket.
