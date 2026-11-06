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

// Runs on the audio thread: mono, resample to 16 kHz, emit 20 ms PCM16 frames + level.
const WORKLET = `
class Capture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.ratio = sampleRate / 16000;
    this.pos = 0;
    this.out = new Int16Array(320);
    this.n = 0;
    this.level = 0;
  }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (!ch) return true;
    let peak = 0;
    for (let i = 0; i < ch.length; i++) { const a = Math.abs(ch[i]); if (a > peak) peak = a; }
    this.level = Math.max(peak, this.level * 0.9);
    while (this.pos < ch.length) {
      const i = Math.floor(this.pos), f = this.pos - i;
      const s = i + 1 < ch.length ? ch[i] * (1 - f) + ch[i + 1] * f : ch[i];
      this.out[this.n++] = Math.max(-32768, Math.min(32767, s * 32767));
      if (this.n === 320) {
        this.port.postMessage({ pcm: this.out.buffer, level: this.level }, [this.out.buffer]);
        this.out = new Int16Array(320);
        this.n = 0;
      }
      this.pos += this.ratio;
    }
    this.pos -= ch.length;
    return true;
  }
}
registerProcessor("persona-capture", Capture);
`;

export class CallClient {
  private ws: WebSocket | null = null;
  private ctx: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private node: AudioWorkletNode | null = null;
  private outRate = 24000;
  private nextTime = 0;
  private sources = new Set<AudioBufferSourceNode>();
  private botDone = false;
  private muted = false;
  private ended = false;
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
    // Mic first: the permission prompt must come from the user's tap.
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        channelCount: 1,
      },
    });
    this.ctx = new AudioContext({ latencyHint: "interactive" });
    await this.ctx.resume();
    const url = URL.createObjectURL(new Blob([WORKLET], { type: "application/javascript" }));
    await this.ctx.audioWorklet.addModule(url);
    URL.revokeObjectURL(url);

    const token = await api.wsToken();
    const ws = new WebSocket(
      `${api.wsUrl("/ws/call", token)}&chat_id=${encodeURIComponent(this.chatId)}`,
    );
    ws.binaryType = "arraybuffer";
    this.ws = ws;
    ws.onmessage = (e) =>
      typeof e.data === "string" ? this.onJson(JSON.parse(e.data)) : this.onAudio(e.data);
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

    const src = this.ctx.createMediaStreamSource(this.stream);
    this.node = new AudioWorkletNode(this.ctx, "persona-capture");
    this.node.port.onmessage = (e: MessageEvent<{ pcm: ArrayBuffer; level: number }>) => {
      this.emit("level", this.muted ? 0 : e.data.level);
      if (!this.muted && ws.readyState === WebSocket.OPEN) ws.send(e.data.pcm);
    };
    src.connect(this.node);
    // Keep the graph pulled without making the mic audible.
    const sink = this.ctx.createGain();
    sink.gain.value = 0;
    this.node.connect(sink).connect(this.ctx.destination);
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

  private onAudio(buf: ArrayBuffer) {
    const ctx = this.ctx;
    if (!ctx || !buf.byteLength) return;
    const pcm = new Int16Array(buf);
    const audio = ctx.createBuffer(1, pcm.length, this.outRate);
    const ch = audio.getChannelData(0);
    for (let i = 0; i < pcm.length; i++) ch[i] = pcm[i] / 32768;
    const src = ctx.createBufferSource();
    src.buffer = audio;
    src.connect(ctx.destination);
    const at = Math.max(ctx.currentTime + 0.03, this.nextTime);
    src.start(at);
    this.nextTime = at + audio.duration;
    this.sources.add(src);
    src.onended = () => {
      this.sources.delete(src);
      this.checkDrained();
    };
  }

  private checkDrained() {
    if (this.botDone && this.sources.size === 0) {
      this.botDone = false;
      this.send({ type: "playback_done" });
    }
  }

  /** Stop everything queued for playback right now. */
  private flush() {
    this.botDone = false;
    for (const s of this.sources) {
      s.onended = null;
      try {
        s.stop();
      } catch {
        /* already stopped */
      }
    }
    this.sources.clear();
    this.nextTime = 0;
  }

  private send(m: Record<string, unknown>) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(m));
  }

  setMuted(m: boolean) {
    this.muted = m;
    this.send({ type: "mute", muted: m });
  }

  /** Tap-to-interrupt. */
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
    this.node?.disconnect();
    this.stream?.getTracks().forEach((t) => t.stop());
    void this.ctx?.close();
    this.emit("state", "ended");
  }
}
