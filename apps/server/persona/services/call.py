"""Real-time voice call session.

Mic PCM16 (16 kHz) -> VAD -> STT -> chat_engine.generate (LLM stream) -> sentence chunks ->
TTS per sentence -> PCM16 at OUTPUT_RATE back to the client, in small frames.

Barge-in: user speech while the character is thinking or speaking cancels generation and
synthesis, tells the client to flush its playback queue, and trims the saved reply to what
was actually spoken.
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
import time
from collections.abc import Awaitable, Callable
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from persona.models import Character, Chat, MessageCandidate, User
from persona.services import audio, chat_engine, settings_store
from persona.services.http import ProviderError
from persona.services.llm.base import LLMError
from persona.services.stt import registry as stt
from persona.services.tts import registry as tts
from persona.services.tts.service import voice_for_character, voice_ref
from persona.services.vad import StreamingVAD

log = logging.getLogger("persona.call")
OUTPUT_RATE = 24000
OUT_FRAME = OUTPUT_RATE * 2 // 10  # 100 ms of PCM16 per binary message
FIRST_CHUNK_MIN = 28  # chars; cut the first sentence early at a comma for latency

SendJson = Callable[[dict[str, Any]], Awaitable[None]]
SendBytes = Callable[[bytes], Awaitable[None]]


def _balance_actions(chunks: list[str], rest: str) -> tuple[list[str], str]:
    """Never end a chunk inside an open *action*: "*leans in. Smiles*" stays one piece, so
    speakable() can drop the whole action instead of reading half of it aloud."""
    out: list[str] = []
    pending = ""
    for c in chunks:
        pending = f"{pending} {c}" if pending else c
        if pending.count("*") % 2 == 0:
            out.append(pending)
            pending = ""
    if pending:
        rest = f"{pending} {rest}" if rest else pending
    return out, rest


def chunk_text(buffer: str, first: bool) -> tuple[list[str], str]:
    chunks, rest = audio.split_sentences(buffer)
    if first and not chunks and len(rest) >= FIRST_CHUNK_MIN and rest.count("*") % 2 == 0:
        cut = max(rest.rfind(", "), rest.rfind("; "), rest.rfind(" - "))
        if cut >= FIRST_CHUNK_MIN - 4 and rest[: cut + 1].count("*") % 2 == 0:
            chunks, rest = [rest[: cut + 1].strip()], rest[cut + 1 :].lstrip()
    return _balance_actions(chunks, rest)


class CallSession:
    def __init__(
        self,
        db: AsyncSession,
        chat: Chat,
        user: User,
        character: Character,
        send_json: SendJson,
        send_bytes: SendBytes,
    ) -> None:
        self.db, self.chat, self.user, self.character = db, chat, user, character
        self.send_json, self.send_bytes = send_json, send_bytes
        self.vad = StreamingVAD()
        self.muted = False
        self.state = "listening"
        self.turn: asyncio.Task | None = None
        self.cfg: dict[str, Any] = {}
        self.voice = None
        self.spoken: list[str] = []
        self.candidate_id: str | None = None
        self.awaiting_playback = False
        self._partial_task: asyncio.Task | None = None
        self._last_partial = 0.0
        self.partials = False
        self.closed = False

    async def start(self) -> None:
        self.cfg = await settings_store.load(self.db)
        if (self.cfg.get("stt_provider") or "none") == "none":
            raise ProviderError("Speech recognition is off on this server")
        if (self.cfg.get("tts_provider") or "none") == "none":
            raise ProviderError("Voices are off on this server")
        self.voice = await voice_for_character(self.db, self.character, self.cfg)
        if self.voice is None:
            raise ProviderError("No voice available for this character")
        # Live partial transcripts only when STT is local and fast enough to afford them.
        self.partials = self.cfg.get("stt_provider") in ("faster-whisper", "mock")
        await self.send_json(
            {
                "type": "ready",
                "output_rate": OUTPUT_RATE,
                "input_rate": 16000,
                "voice": self.voice.name,
            }
        )
        await self.set_state("listening")

    async def set_state(self, state: str) -> None:
        self.state = state
        self.vad.barge_in = state in ("thinking", "speaking")
        await self.send_json({"type": "state", "state": state})

    # ---------------------------------------------------------------- input
    async def on_audio(self, data: bytes) -> None:
        if self.muted or self.closed:
            return
        for ev in self.vad.feed(data):
            if ev.kind == "start":
                if self.state in ("thinking", "speaking"):
                    await self.interrupt("barge-in")
                await self.send_json({"type": "vad", "speaking": True})
            elif ev.kind in ("end", "discard"):
                await self.send_json({"type": "vad", "speaking": False})
                if ev.kind == "end":
                    await self.start_turn(ev.audio)
        if self.vad.speaking and self.partials:
            self._maybe_partial()

    def _maybe_partial(self) -> None:
        now = time.monotonic()
        if now - self._last_partial < 1.0 or (self._partial_task and not self._partial_task.done()):
            return
        pcm = self.vad.current_audio
        if len(pcm) < 16000 * 2 * 0.8:
            return
        self._last_partial = now

        async def run() -> None:
            with contextlib.suppress(Exception):
                text = await stt.transcribe(self.cfg, pcm)
                if text and self.vad.speaking:
                    await self.send_json({"type": "partial", "text": text})

        self._partial_task = asyncio.create_task(run())

    async def on_control(self, msg: dict[str, Any]) -> None:
        kind = msg.get("type")
        if kind == "mute":
            self.muted = bool(msg.get("muted"))
            if self.muted:
                self.vad.reset()
        elif kind == "interrupt":
            await self.interrupt("manual")
        elif kind == "playback_done":
            # awaiting_playback is only set once the reply has been fully sent, so this is
            # safe even if the turn task hasn't returned yet. (Waiting for turn.done() lost
            # the race when there was little or no audio, e.g. replies that were all *actions*,
            # leaving the call stuck in "speaking".)
            if self.awaiting_playback:
                self.awaiting_playback = False
                await self.set_state("listening")
        elif kind == "text":  # typed message during a call
            text = str(msg.get("text", "")).strip()[:2000]
            if text:
                await self.interrupt("text")
                await self.start_turn(b"", text=text)

    # ---------------------------------------------------------------- turn
    async def start_turn(self, pcm: bytes, text: str | None = None) -> None:
        # One DB session per call: never let two turns touch it at once.
        if self.turn and not self.turn.done():
            self.turn.cancel()
            with contextlib.suppress(asyncio.CancelledError, Exception):
                await self.turn
        self.turn = asyncio.create_task(self._turn(pcm, text))

    async def interrupt(self, reason: str) -> None:
        busy = self.turn and not self.turn.done()
        if busy:
            self.turn.cancel()
            with contextlib.suppress(asyncio.CancelledError, Exception):
                await self.turn
        if busy or self.awaiting_playback:
            await self.send_json({"type": "interrupt", "reason": reason})
        self.awaiting_playback = False
        if self.state != "listening":
            await self.set_state("listening")

    async def _turn(self, pcm: bytes, text: str | None) -> None:
        t0 = time.monotonic()
        metrics: dict[str, int] = {}
        try:
            if text is None:
                await self.set_state("thinking")
                text = await stt.transcribe(self.cfg, pcm)
                metrics["stt_ms"] = int((time.monotonic() - t0) * 1000)
                if not text or len(text.strip()) < 2:
                    await self.set_state("listening")
                    return
            else:
                await self.set_state("thinking")
            umsg = await chat_engine.add_message(self.db, self.chat, "user", text)
            await self.send_json({"type": "user_text", "text": text, "message_id": umsg.id})
            await chat_engine.bump_interactions(self.db, [self.character.id])
            await self._respond(t0, metrics)
        except asyncio.CancelledError:
            await self._trim_interrupted()
            raise
        except (ProviderError, LLMError) as e:
            await self.send_json({"type": "error", "detail": str(e)})
            await self.set_state("listening")
        except Exception:  # noqa: BLE001
            log.exception("call turn failed")
            await self.send_json({"type": "error", "detail": "Something went wrong"})
            await self.set_state("listening")

    async def _respond(self, t0: float, metrics: dict[str, int]) -> None:
        self.spoken = []
        self.candidate_id = None
        sentences: asyncio.Queue[str | None] = asyncio.Queue()
        speaker = asyncio.create_task(self._speak_loop(sentences, t0, metrics))
        buffer, first = "", True
        gen = chat_engine.generate(self.db, self.chat, self.user, self.character)
        try:
            async for ev in gen:
                if ev["type"] == "start":
                    self.candidate_id = ev["candidate_id"]
                    await self.send_json({"type": "bot_start", "message_id": ev["message_id"]})
                elif ev["type"] == "delta":
                    if "llm_first_token_ms" not in metrics:
                        metrics["llm_first_token_ms"] = int((time.monotonic() - t0) * 1000)
                    await self.send_json({"type": "bot_text_delta", "text": ev["text"]})
                    buffer += ev["text"]
                    chunks, buffer = chunk_text(buffer, first)
                    for c in chunks:
                        if audio.speakable(c):
                            first = False
                            await sentences.put(c)
                elif ev["type"] == "done":
                    final = ev["message"]
                    sel = next(
                        (
                            c
                            for c in final["candidates"]
                            if c["id"] == final["selected_candidate_id"]
                        ),
                        None,
                    )
                    await self.send_json(
                        {
                            "type": "bot_text",
                            "message_id": final["id"],
                            "text": sel["content"] if sel else "",
                        }
                    )
                elif ev["type"] == "error":
                    raise LLMError(ev["detail"])
            if buffer.strip() and audio.speakable(buffer):
                await sentences.put(buffer.strip())
            await sentences.put(None)
            await speaker
        finally:
            # Close the generator now so its own partial save runs before any trimming.
            with contextlib.suppress(Exception):
                await gen.aclose()
            if not speaker.done():
                speaker.cancel()
                with contextlib.suppress(asyncio.CancelledError, Exception):
                    await speaker
        await self.send_json({"type": "bot_done", "metrics": metrics})
        if self.spoken:
            self.awaiting_playback = True  # back to listening when the client says it's done
        else:
            await self.set_state("listening")  # nothing was audible (e.g. only *actions*)

    async def _speak_loop(
        self, q: asyncio.Queue[str | None], t0: float, metrics: dict[str, int]
    ) -> None:
        ref = voice_ref(self.voice)
        while True:
            sentence = await q.get()
            if sentence is None:
                return
            speech = await tts.speak(self.cfg, ref, audio.speakable(sentence))
            pcm = audio.resample_pcm16(speech.pcm, speech.rate, OUTPUT_RATE)
            if not pcm:
                continue
            if self.state != "speaking":
                await self.set_state("speaking")
            if "first_audio_ms" not in metrics:
                metrics["first_audio_ms"] = int((time.monotonic() - t0) * 1000)
                await self.send_json({"type": "metrics", **metrics})
            await self.send_json({"type": "audio", "text": sentence})
            for i in range(0, len(pcm), OUT_FRAME):
                await self.send_bytes(pcm[i : i + OUT_FRAME])
            self.spoken.append(sentence)

    async def _trim_interrupted(self) -> None:
        """Keep the saved reply consistent with what the user actually heard."""
        if not self.candidate_id:
            return
        cand = await self.db.get(MessageCandidate, self.candidate_id)
        if cand is None:
            return
        heard = " ".join(self.spoken).strip()
        cand.content = f"{heard} …" if heard else "…"
        cand.finish_reason = "interrupted"
        await self.db.commit()

    async def close(self) -> None:
        self.closed = True
        if self.turn and not self.turn.done():
            self.turn.cancel()
            with contextlib.suppress(asyncio.CancelledError, Exception):
                await self.turn
        if self._partial_task and not self._partial_task.done():
            self._partial_task.cancel()
