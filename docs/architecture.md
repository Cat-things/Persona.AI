# Architecture

```
 Browser (PWA) / Expo app
        │  HTTPS: REST /api/v1/*      WSS: /api/v1/ws/chat, /api/v1/ws/call
        ▼
 Caddy (optional, auto HTTPS)
        ▼
 persona serve  (FastAPI + uvicorn, also serves the built web app)
   ├─ api/        routers: auth, users, characters, chats, rooms, personas, cards,
   │              images, voices, calls, admin, ws
   ├─ services/   chat_engine, prompt (token budgeting), memory (summaries),
   │              llm/, imagegen/, tts/, stt/, vad, call, content_filter, jobs, backup
   ├─ models/     SQLAlchemy (SQLite WAL by default, Postgres optional)
   └─ embedded job loop (optional)
 persona worker   same codebase; runs jobs from the `jobs` table (avatars, TTS pre-render)
 Redis (optional) shared rate limits, job wake-ups
```

## Chat turn

1. The client sends `{"type":"send"}` over `/ws/chat` (or `POST /chats/{id}/messages` for SSE).
2. The user message is stored; the speaking character is chosen (rooms use mentions, round-robin,
   or least-recent speaker).
3. `prompt.build` assembles the context within `context_tokens − max_reply`: system block
   (character, persona, filter rules) → pinned memories (≤15%) → rolling summary (≤15%) → first
   example dialog → newest history → more examples if space remains.
4. Tokens stream from the provider; the output filter checks every ~120 characters.
5. The reply is saved as a **candidate** on an assistant message. Regenerate adds another
   candidate (a swipe); ratings belong to candidates.
6. If old messages fell out of the window and aren't in the summary yet, a background task folds
   them into the rolling summary.

## Calls

```
mic ─ AudioWorklet (16 kHz PCM16, 20 ms) ─► /ws/call
      VAD (adaptive energy) ─► utterance ─► STT ─► chat message
      ─► LLM stream ─► sentence chunker ─► TTS per sentence ─► 24 kHz PCM16 frames ─► speaker
```

TTS for sentence *n+1* runs while sentence *n* plays. When the user speaks during the reply
(stricter VAD threshold, 240 ms sustained), the server cancels the LLM and TTS tasks, sends
`interrupt` so the client drops queued audio, and trims the stored reply to the sentences that were
actually played.

## Auth

Argon2id password hashes; 15-minute JWT access tokens; 30-day refresh tokens that rotate on every
use, stored hashed, with reuse detection that revokes the whole token family. The web app keeps
the refresh token in an httpOnly `SameSite=Strict` cookie; the mobile app keeps it in the secure
keystore. WebSockets authenticate with a 2-minute single-purpose token.

## Data

All IDs are 32-character hex UUIDs. Tables: users, refresh_tokens, invites, characters,
character_likes, personas, rooms, room_members, chats, messages, message_candidates, memories,
voices, media, jobs, reports, settings, push_tokens, notifications. Migrations are Alembic,
applied automatically by `persona serve`.
