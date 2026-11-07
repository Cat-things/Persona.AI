import { Platform } from "react-native";
import {
  AudioBufferQueueSourceNode,
  AudioContext,
  AudioManager,
  AudioRecorder,
} from "react-native-audio-api";
import { api } from "./api";

export type CallState = "connecting" | "listening" | "thinking" | "speaking" | "ended" | "error";

export interface CallEvents {
  state: (s: CallState) => void;
  userSpeaking: (on: boolean) => void;
  partial: (text: string) => void;
  userText: (text: string) => void;
  botDelta: (text: string) => void;
  botText: (text: string) => void;
  error: (detail: string, fatal: boolean) => void;
  metrics: (m: Record<string, number>) => void;
  level: (v: number) => void;
}

const IN_RATE = 16000;
const FRAME = 320; // 20 ms at 16 kHz, what the server's VAD expects

/**
 * Native twin of the web CallClient (same /ws/call protocol).
 * Capture: platform echo cancellation (Android `voiceCommunication`, iOS voice processing),
 * resampled to 16 kHz PCM16 in 20 ms frames. Playback: 24 kHz PCM16 chunks queued gaplessly.
 */
export class CallClient {
  private ws: WebSocket | null = null;
  private ctx: AudioContext | null = null;
  private recorder: AudioRecorder | null = null;
  private queue: AudioBufferQueueSourceNode | null = null;
  private queued = 0;
  private outRate = 24000;
  private botDone = false;
  private muted = false;
  private ended = false;
  private pending = new Int16Array(FRAME);
  private pendingN = 0;
  private resamplePos = 0;
  private level = 0;
  private listeners: Partial<CallEvents> = {};

  constructor(private chatId: string) {}

  on<K extends keyof CallEvents>(k: K, fn: CallEvents[K]) {
    this.listeners[k] = fn;
    return this;
  }

  private emit<K extends keyof CallEvents>(k: K, ...args: Parameters<CallEvents[K]>) {
    (this.listeners[k] as ((...a: Parameters<CallEvents[K]>) => void) | undefined)?.(...args);
  }

  async start() {
    this.emit("state", "connecting");
    const perm = await AudioManager.requestRecordingPermissions();
    if (perm !== "Granted")
      throw new Error("Microphone access is off. Turn it on in system settings.");

    AudioManager.setSystemOptions({
      ios: {
        category: "playAndRecord",
        mode: "voiceChat",
        options: ["defaultToSpeaker", "allowBluetoothHFP"],
      },
      android:
        Number(Platform.Version) >= 31
          ? { mode: "inCommunication", communicationDevice: "speaker" }
          : {},
    });
    await AudioManager.setAudioSessionActivity(true);

    this.ctx = new AudioContext({ sampleRate: this.outRate });
    const token = await api.wsToken();
    const ws = new WebSocket(
      `${api.wsUrl("/ws/call", token)}&chat_id=${encodeURIComponent(this.chatId)}`,
    );
    ws.binaryType = "arraybuffer";
    this.ws = ws;
    ws.onmessage = (e) =>
      typeof e.data === "string"
        ? this.onJson(JSON.parse(e.data))
        : this.onAudio(e.data as ArrayBuffer);
    ws.onclose = () => {
      if (!this.ended) {
        this.emit("error", "The call was disconnected.", true);
        this.hangup();
      }
    };
    await new Promise<void>((res, rej) => {
      ws.onopen = () => res();
      ws.onerror = () => rej(new Error("Couldn't connect the call"));
    });

    const rec = new AudioRecorder({
      androidInputPreset: "voiceCommunication",
      iosVoiceProcessing: true,
    });
    this.recorder = rec;
    rec.onAudioReady(
      { sampleRate: IN_RATE, bufferLength: FRAME * 5, channelCount: 1 },
      ({ buffer }) => {
        this.capture(buffer.getChannelData(0), buffer.sampleRate);
      },
    );
    const r = await rec.start();
    if (r.status === "error") throw new Error("Couldn't start the microphone");
  }

  /** Mono float samples at any rate -> 16 kHz PCM16 frames on the socket. */
  private capture(ch: Float32Array, rate: number) {
    let peak = 0;
    for (let i = 0; i < ch.length; i++) {
      const a = Math.abs(ch[i]);
      if (a > peak) peak = a;
    }
    this.level = Math.max(peak, this.level * 0.9);
    this.emit("level", this.muted ? 0 : this.level);

    const ratio = rate / IN_RATE;
    while (this.resamplePos < ch.length) {
      const i = Math.floor(this.resamplePos);
      const f = this.resamplePos - i;
      const s = i + 1 < ch.length ? ch[i] * (1 - f) + ch[i + 1] * f : ch[i];
      this.pending[this.pendingN++] = Math.max(-32768, Math.min(32767, Math.round(s * 32767)));
      if (this.pendingN === FRAME) {
        if (!this.muted && this.ws?.readyState === WebSocket.OPEN)
          this.ws.send(this.pending.buffer.slice(0));
        this.pendingN = 0;
      }
      this.resamplePos += ratio;
    }
    this.resamplePos -= ch.length;
  }

  private onJson(ev: Record<string, unknown>) {
    switch (ev.type) {
      case "ready":
        this.outRate = Number(ev.output_rate) || 24000;
        break;
      case "state":
        this.emit("state", ev.state as CallState);
        break;
      case "vad":
        this.emit("userSpeaking", !!ev.speaking);
        break;
      case "partial":
        this.emit("partial", String(ev.text));
        break;
      case "user_text":
        this.emit("userText", String(ev.text));
        break;
      case "bot_start":
        this.botDone = false;
        break;
      case "bot_text_delta":
        this.emit("botDelta", String(ev.text));
        break;
      case "bot_text":
        this.emit("botText", String(ev.text));
        break;
      case "bot_done":
        this.botDone = true;
        this.checkDrained();
        break;
      case "interrupt":
        this.flush();
        break;
      case "metrics":
        this.emit("metrics", ev as unknown as Record<string, number>);
        break;
      case "error":
        this.emit("error", String(ev.detail), !!ev.fatal);
        if (ev.fatal) this.hangup();
        break;
    }
  }

  private ensureQueue(): AudioBufferQueueSourceNode | null {
    const ctx = this.ctx;
    if (!ctx) return null;
    if (!this.queue) {
      const q = ctx.createBufferQueueSource();
      q.connect(ctx.destination);
      q.onbufferended = () => {
        this.queued = Math.max(0, this.queued - 1);
        this.checkDrained();
      };
      q.start(ctx.currentTime);
      this.queue = q;
    }
    return this.queue;
  }

  private onAudio(buf: ArrayBuffer) {
    if (!this.ctx || !buf.byteLength) return;
    const pcm = new Int16Array(buf);
    const audio = this.ctx.createBuffer(1, pcm.length, this.outRate);
    const f32 = new Float32Array(pcm.length);
    for (let i = 0; i < pcm.length; i++) f32[i] = pcm[i] / 32768;
    audio.copyToChannel(f32, 0);
    const q = this.ensureQueue();
    if (!q) return;
    q.enqueueBuffer(audio);
    this.queued++;
  }

  private checkDrained() {
    if (this.botDone && this.queued === 0) {
      this.botDone = false;
      this.send({ type: "playback_done" });
    }
  }

  /** Drop everything queued for playback right now. */
  private flush() {
    this.botDone = false;
    this.queued = 0;
    const q = this.queue;
    this.queue = null;
    if (q) {
      q.onbufferended = null;
      try {
        q.clearBuffers();
        q.stop();
      } catch {
        /* already stopped */
      }
      q.disconnect();
    }
  }

  private send(m: Record<string, unknown>) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(m));
  }

  setMuted(m: boolean) {
    this.muted = m;
    this.send({ type: "mute", muted: m });
  }

  interrupt() {
    this.flush();
    this.send({ type: "interrupt" });
  }

  hangup() {
    if (this.ended) return;
    this.ended = true;
    this.send({ type: "hangup" });
    this.flush();
    this.ws?.close();
    this.recorder?.clearOnAudioReady();
    void this.recorder?.stop();
    void this.ctx?.close();
    void AudioManager.setAudioSessionActivity(false).catch(() => {});
    this.emit("state", "ended");
  }
}
