import { useQuery } from "@tanstack/react-query";
import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from "expo-audio";
import { api } from "./api";
import { create } from "./store";

interface PlayerState {
  playing: string | null; // "m:<messageId>" | "v:<voiceId>"
  loading: string | null;
}

/** One app-wide player: starting a new clip stops the previous one (like the web app). */
class VoicePlayer {
  state = create<PlayerState>({ playing: null, loading: null });
  private player: AudioPlayer | null = null;
  private sub: { remove(): void } | null = null;

  stop() {
    this.sub?.remove();
    this.sub = null;
    this.player?.remove();
    this.player = null;
    this.state.set({ playing: null, loading: null });
  }

  private async play(key: string, url: string) {
    if (this.state.get().playing === key || this.state.get().loading === key) {
      this.stop();
      return;
    }
    this.stop();
    this.state.set({ playing: null, loading: key });
    await setAudioModeAsync({ playsInSilentMode: true, interruptionMode: "duckOthers" });
    const headers = await api.authHeaders();
    const p = createAudioPlayer({ uri: url, headers });
    this.player = p;
    this.sub = p.addListener("playbackStatusUpdate", (s) => {
      if (this.player !== p) return;
      if (s.isLoaded && this.state.get().loading === key)
        this.state.set({ playing: key, loading: null });
      if (s.didJustFinish) this.stop();
    });
    p.play();
  }

  playMessage(messageId: string) {
    return this.play(`m:${messageId}`, api.ttsUrl(messageId));
  }

  preview(voiceId: string) {
    return this.play(`v:${voiceId}`, api.voicePreviewUrl(voiceId));
  }
}

export const voicePlayer = new VoicePlayer();
export const useVoicePlayer = () => voicePlayer.state.use();

export function useCaps() {
  return useQuery({
    queryKey: ["capabilities"],
    queryFn: () => api.capabilities(),
    staleTime: 60_000,
  });
}
