import { useQuery } from "@tanstack/react-query";
import { useSyncExternalStore } from "react";
import { api } from "./api";

type State = { playing: string | null; loading: string | null; error: string | null };

/** One shared <audio> so starting a new clip always stops the previous one. */
class VoicePlayer {
  private audio: HTMLAudioElement | null = null;
  private cache = new Map<string, string>(); // key -> object URL
  private listeners = new Set<() => void>();
  state: State = { playing: null, loading: null, error: null };

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };

  private set(p: Partial<State>) {
    this.state = { ...this.state, ...p };
    this.listeners.forEach((f) => f());
  }

  private el() {
    if (!this.audio) {
      this.audio = new Audio();
      this.audio.addEventListener("ended", () => this.set({ playing: null }));
      this.audio.addEventListener("pause", () => this.set({ playing: null }));
    }
    return this.audio;
  }

  stop() {
    this.audio?.pause();
    this.set({ playing: null, loading: null });
  }

  async play(key: string, load: () => Promise<Blob>) {
    if (this.state.playing === key) return this.stop();
    this.stop();
    this.set({ loading: key, error: null });
    try {
      let url = this.cache.get(key);
      if (!url) {
        url = URL.createObjectURL(await load());
        this.cache.set(key, url);
        if (this.cache.size > 60) {
          const [k, u] = this.cache.entries().next().value!;
          URL.revokeObjectURL(u);
          this.cache.delete(k);
        }
      }
      if (this.state.loading !== key) return; // cancelled meanwhile
      const a = this.el();
      a.src = url;
      await a.play();
      this.set({ playing: key, loading: null });
    } catch (e) {
      this.set({
        loading: null,
        playing: null,
        error: e instanceof Error ? e.message : "Playback failed",
      });
      throw e;
    }
  }

  playMessage(messageId: string) {
    return this.play(`m:${messageId}`, () => api.tts(messageId));
  }

  preview(voiceId: string) {
    return this.play(`v:${voiceId}`, () => api.previewVoice(voiceId));
  }
}

export const voicePlayer = new VoicePlayer();

export function useVoicePlayer() {
  return useSyncExternalStore(voicePlayer.subscribe, () => voicePlayer.state);
}

export function useCaps() {
  return useQuery({
    queryKey: ["capabilities"],
    queryFn: api.capabilities,
    staleTime: 60_000,
  });
}
