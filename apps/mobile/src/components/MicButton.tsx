import {
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
} from "expo-audio";
import { Loader2, Mic, Square } from "lucide-react-native";
import { useState } from "react";
import { api, errorText } from "../lib/api";
import { useTheme } from "../lib/theme";
import { IconButton, useToast } from "./ui";

/**
 * Tap to dictate, tap again to stop; the clip is transcribed by the server and appended to
 * the composer. Uses the AAC/m4a preset on both platforms (the low-quality Android preset
 * writes AMR in a .m4a-named file, which servers reject).
 */
export function MicButton({ onText }: { onText: (t: string) => void }) {
  const { c } = useTheme();
  const toast = useToast();
  const recorder = useAudioRecorder({
    ...RecordingPresets.HIGH_QUALITY,
    numberOfChannels: 1,
    bitRate: 64000,
  });
  const [state, setState] = useState<"idle" | "recording" | "working">("idle");

  const toggle = async () => {
    if (state === "working") return;
    if (state === "idle") {
      const perm = await requestRecordingPermissionsAsync();
      if (!perm.granted) {
        toast("Microphone access is off. Turn it on in system settings.", "error");
        return;
      }
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await recorder.prepareToRecordAsync();
      recorder.record();
      setState("recording");
      return;
    }
    setState("working");
    try {
      await recorder.stop();
      await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });
      const uri = recorder.uri;
      if (!uri) throw new Error("Nothing was recorded");
      const { text } = await api.transcribe({ uri, name: "dictation.m4a", type: "audio/mp4" });
      if (text.trim()) onText(text.trim());
      else toast("Didn't catch that. Try again a little closer to the mic.");
    } catch (e) {
      toast(errorText(e), "error");
    } finally {
      setState("idle");
    }
  };

  return (
    <IconButton
      label={state === "recording" ? "Stop dictation" : "Dictate a message"}
      onPress={toggle}
      active={state === "recording"}
      size={42}
    >
      {state === "working" ? (
        <Loader2 size={20} color={c.ink2} />
      ) : state === "recording" ? (
        <Square size={16} color={c.ember} fill={c.ember} />
      ) : (
        <Mic size={21} color={c.ink2} />
      )}
    </IconButton>
  );
}
