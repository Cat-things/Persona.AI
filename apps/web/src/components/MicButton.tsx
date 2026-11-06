import clsx from "clsx";
import { Loader2, Mic, Square } from "lucide-react";
import { useRef, useState } from "react";
import { api } from "../lib/api";
import { errorText, useToast } from "../lib/toast";

/** Tap to record, tap again to transcribe into the composer. */
export function MicButton({ onText }: { onText: (text: string) => void }) {
  const toast = useToast();
  const [state, setState] = useState<"idle" | "recording" | "busy">("idle");
  const rec = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);

  const start = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      });
      const type = ["audio/webm;codecs=opus", "audio/mp4", "audio/ogg"].find((t) =>
        MediaRecorder.isTypeSupported(t),
      );
      const r = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
      chunks.current = [];
      r.ondataavailable = (e) => e.data.size && chunks.current.push(e.data);
      r.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunks.current, { type: r.mimeType });
        if (blob.size < 2000) return setState("idle");
        setState("busy");
        try {
          const ext = r.mimeType.includes("mp4")
            ? "m4a"
            : r.mimeType.includes("ogg")
              ? "ogg"
              : "webm";
          const { text } = await api.transcribe(
            new File([blob], `voice.${ext}`, { type: r.mimeType }),
          );
          if (text) onText(text);
          else toast("Didn't catch that. Try again a little closer to the mic.");
        } catch (e) {
          toast(errorText(e), "error");
        } finally {
          setState("idle");
        }
      };
      rec.current = r;
      r.start();
      setState("recording");
    } catch (e) {
      toast(
        e instanceof DOMException && e.name === "NotAllowedError"
          ? "Microphone access was blocked."
          : errorText(e),
        "error",
      );
    }
  };

  return (
    <button
      type="button"
      className={clsx(
        "icon-btn size-10",
        state === "recording" && "bg-err text-white hover:bg-err hover:text-white",
      )}
      onClick={() => (state === "recording" ? rec.current?.stop() : state === "idle" && start())}
      aria-label={state === "recording" ? "Stop recording" : "Speak your message"}
      aria-pressed={state === "recording"}
      disabled={state === "busy"}
    >
      {state === "busy" ? (
        <Loader2 size={18} className="animate-spin" />
      ) : state === "recording" ? (
        <Square size={14} fill="currentColor" />
      ) : (
        <Mic size={18} />
      )}
    </button>
  );
}
