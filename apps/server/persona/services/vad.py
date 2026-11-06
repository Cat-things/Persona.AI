"""Streaming voice activity detection on 16 kHz PCM16, 20 ms frames.

Energy-based with an adaptive noise floor. Browsers already apply echo cancellation and
noise suppression to the mic, so this is a good, dependency-free default. `barge_in` mode
raises the bar while the character is talking so leaked playback doesn't interrupt it.
"""

from __future__ import annotations

from collections import deque
from dataclasses import dataclass, field

import numpy as np

RATE = 16000
FRAME_MS = 20
FRAME_BYTES = RATE * FRAME_MS // 1000 * 2  # 640


def rms_db(frame: bytes) -> float:
    x = np.frombuffer(frame, dtype="<i2").astype(np.float32)
    if x.size == 0:
        return -100.0
    rms = float(np.sqrt(np.mean(x * x))) / 32768.0
    return 20.0 * np.log10(max(rms, 1e-6))


@dataclass
class VADConfig:
    start_frames: int = 4  # 80 ms of speech to start
    end_silence_ms: int = 550  # end-of-utterance silence
    min_speech_ms: int = 250  # shorter blips are ignored
    max_utterance_s: float = 30.0
    margin_db: float = 12.0  # above noise floor
    min_db: float = -45.0  # absolute floor for "speech"
    barge_margin_db: float = 18.0
    barge_frames: int = 12  # 240 ms sustained speech to interrupt
    preroll_ms: int = 300


@dataclass
class VADEvent:
    kind: str  # "start" | "end" | "discard"
    audio: bytes = b""


@dataclass
class StreamingVAD:
    cfg: VADConfig = field(default_factory=VADConfig)
    noise_db: float = -60.0
    speaking: bool = False
    barge_in: bool = False
    _buf: bytearray = field(default_factory=bytearray)
    _pending: bytearray = field(default_factory=bytearray)
    _preroll: deque = field(default_factory=deque)
    _voiced_run: int = 0
    _silence_ms: int = 0
    _speech_ms: int = 0

    def reset(self) -> None:
        self.speaking = False
        self._buf.clear()
        self._voiced_run = 0
        self._silence_ms = 0
        self._speech_ms = 0

    def _is_voiced(self, db: float) -> bool:
        margin = self.cfg.barge_margin_db if self.barge_in else self.cfg.margin_db
        return db > max(self.noise_db + margin, self.cfg.min_db)

    def feed(self, data: bytes) -> list[VADEvent]:
        """Feed arbitrary-sized PCM; returns events for completed frames."""
        self._pending.extend(data)
        events: list[VADEvent] = []
        while len(self._pending) >= FRAME_BYTES:
            frame = bytes(self._pending[:FRAME_BYTES])
            del self._pending[:FRAME_BYTES]
            ev = self._frame(frame)
            if ev:
                events.append(ev)
        return events

    def _frame(self, frame: bytes) -> VADEvent | None:
        db = rms_db(frame)
        voiced = self._is_voiced(db)
        if not self.speaking:
            # adapt noise floor only while not speaking (fast down, slow up)
            if not voiced:
                rate = 0.2 if db < self.noise_db else 0.02
                self.noise_db += (db - self.noise_db) * rate
            self._preroll.append(frame)
            max_pre = self.cfg.preroll_ms // FRAME_MS
            while len(self._preroll) > max_pre:
                self._preroll.popleft()
            self._voiced_run = self._voiced_run + 1 if voiced else 0
            needed = self.cfg.barge_frames if self.barge_in else self.cfg.start_frames
            if self._voiced_run >= needed:
                self.speaking = True
                self._buf = bytearray(b"".join(self._preroll))
                self._preroll.clear()
                self._speech_ms = self._voiced_run * FRAME_MS
                self._silence_ms = 0
                return VADEvent("start")
            return None

        self._buf.extend(frame)
        if voiced:
            self._speech_ms += FRAME_MS
            self._silence_ms = 0
        else:
            self._silence_ms += FRAME_MS
        too_long = len(self._buf) >= self.cfg.max_utterance_s * RATE * 2
        if self._silence_ms >= self.cfg.end_silence_ms or too_long:
            audio = bytes(self._buf)
            enough = self._speech_ms >= self.cfg.min_speech_ms
            self.reset()
            return VADEvent("end" if enough else "discard", audio)
        return None

    @property
    def current_audio(self) -> bytes:
        return bytes(self._buf)
