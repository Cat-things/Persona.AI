import { useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { Mic, MicOff, Phone, PhoneOff } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { Avatar } from "../components/Avatar";
import { api } from "../lib/api";
import { CallClient, type CallState } from "../lib/callClient";

interface Line {
  who: "you" | "them";
  text: string;
  live?: boolean;
}

const STATE_LABEL: Record<CallState, string> = {
  connecting: "Connecting…",
  listening: "Listening",
  thinking: "Thinking…",
  speaking: "Speaking",
  ended: "Call ended",
  error: "Call failed",
};

function fmt(s: number) {
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function CallPage() {
  const { chatId = "" } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data: chat } = useQuery({
    queryKey: ["chat-head", chatId],
    queryFn: () => api.chat(chatId),
  });
  const character = chat?.character;
  const [started, setStarted] = useState(false);
  const [state, setState] = useState<CallState>("connecting");
  const [muted, setMuted] = useState(false);
  const [userSpeaking, setUserSpeaking] = useState(false);
  const [level, setLevel] = useState(0);
  const [lines, setLines] = useState<Line[]>([]);
  const [error, setError] = useState("");
  const [seconds, setSeconds] = useState(0);
  const [latency, setLatency] = useState<number | null>(null);
  const client = useRef<CallClient | null>(null);
  const transcript = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!started || state === "ended" || state === "error") return;
    const t = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [started, state]);

  useEffect(() => {
    transcript.current?.scrollTo({ top: transcript.current.scrollHeight });
  }, [lines]);

  useEffect(() => () => client.current?.hangup(), []);

  const upsert = (who: Line["who"], text: string, live: boolean, append = false) =>
    setLines((ls) => {
      const last = ls.at(-1);
      if (last && last.who === who && last.live) {
        const copy = ls.slice(0, -1);
        return [...copy, { who, text: append ? last.text + text : text, live }];
      }
      return [...ls.slice(-30), { who, text, live }];
    });

  const start = async () => {
    setStarted(true);
    setError("");
    const c = new CallClient(chatId)
      .on("state", (s) => setState(s))
      .on("userSpeaking", setUserSpeaking)
      .on("level", setLevel)
      .on("partial", (t) => upsert("you", t, true))
      .on("userText", (t) => upsert("you", t, false))
      .on("botDelta", (t) => upsert("them", t, true, true))
      .on("botText", (t) => upsert("them", t, false))
      .on("metrics", (m) => m.first_audio_ms && setLatency(m.first_audio_ms))
      .on("error", (detail, fatal) => {
        setError(detail);
        if (fatal) setState("error");
      });
    client.current = c;
    try {
      await c.start();
    } catch (e) {
      setState("error");
      setError(
        e instanceof DOMException && e.name === "NotAllowedError"
          ? "Microphone access was blocked. Allow it in your browser's site settings."
          : e instanceof Error
            ? e.message
            : "Couldn't start the call",
      );
      c.hangup();
    }
  };

  const hangup = () => {
    client.current?.hangup();
    void qc.invalidateQueries({ queryKey: ["chats"] });
    navigate(`/chat/${chatId}`);
  };

  const toggleMute = () => {
    const m = !muted;
    setMuted(m);
    client.current?.setMuted(m);
  };

  const name = character?.name ?? "";
  const live = started && state !== "ended" && state !== "error";
  const ring = state === "speaking" ? 1.12 : userSpeaking ? 1 + Math.min(0.18, level * 0.6) : 1;

  return (
    <div className="flex h-dvh flex-col items-center bg-bg px-4 pt-[max(24px,env(safe-area-inset-top))] pb-[max(20px,env(safe-area-inset-bottom))]">
      <p className="text-sm text-ink-3 tabular-nums" aria-live="polite">
        {started ? `${STATE_LABEL[state]} · ${fmt(seconds)}` : "Voice call"}
      </p>

      <div className="flex flex-1 flex-col items-center justify-center gap-5 min-h-0 w-full">
        <button
          type="button"
          className="relative rounded-full focus-visible:outline-2"
          onClick={() => state === "speaking" && client.current?.interrupt()}
          aria-label={state === "speaking" ? `Interrupt ${name}` : name}
          disabled={state !== "speaking"}
        >
          <span
            aria-hidden="true"
            className={clsx(
              "absolute inset-0 rounded-full transition-transform duration-150 ease-out-quart",
              state === "speaking"
                ? "bg-ember-soft ring-2 ring-ember"
                : userSpeaking
                  ? "bg-surface-2"
                  : "bg-transparent",
            )}
            style={{ transform: `scale(${ring})` }}
          />
          <Avatar src={character?.avatar_url} name={name || "?"} size={168} className="relative" />
        </button>
        <div className="text-center">
          <h1 className="text-2xl font-bold">{name}</h1>
          {state === "speaking" && (
            <p className="text-xs text-ink-3 mt-1">
              Tap the avatar or just start talking to interrupt
            </p>
          )}
          {latency !== null && (
            <p className="text-xs text-ink-3 mt-1 tabular-nums">
              first reply audio in {(latency / 1000).toFixed(2)} s
            </p>
          )}
        </div>

        <div
          ref={transcript}
          className="w-full max-w-lg flex-1 min-h-0 max-h-56 overflow-y-auto scroll-thin space-y-2 px-1"
          aria-label="Live transcript"
        >
          {lines.map((l, i) => (
            <p
              key={i}
              className={clsx(
                "text-sm leading-relaxed",
                l.who === "you" ? "text-right text-ink-2" : "text-ink",
                l.live && "opacity-70",
              )}
            >
              {l.who === "you" ? "" : <span className="font-semibold">{name}: </span>}
              {l.text}
            </p>
          ))}
        </div>
        {error && (
          <p role="alert" className="text-sm text-err text-center max-w-sm">
            {error}
          </p>
        )}
      </div>

      <div className="flex items-center gap-6">
        {!started || state === "error" ? (
          <>
            <button
              className="flex size-16 items-center justify-center rounded-full bg-surface-2 text-ink"
              onClick={() => navigate(`/chat/${chatId}`)}
              aria-label="Back to chat"
            >
              <PhoneOff size={24} />
            </button>
            <button
              className="flex size-16 items-center justify-center rounded-full bg-ok text-bg"
              onClick={start}
              aria-label={state === "error" ? "Try again" : `Call ${name}`}
            >
              <Phone size={26} />
            </button>
          </>
        ) : (
          <>
            <button
              className={clsx(
                "flex size-16 items-center justify-center rounded-full",
                muted ? "bg-ink text-bg" : "bg-surface-2 text-ink",
              )}
              onClick={toggleMute}
              aria-pressed={muted}
              aria-label={muted ? "Unmute microphone" : "Mute microphone"}
              disabled={!live}
            >
              {muted ? <MicOff size={24} /> : <Mic size={24} />}
            </button>
            <button
              className="flex size-16 items-center justify-center rounded-full bg-err text-white"
              onClick={hangup}
              aria-label="Hang up"
            >
              <PhoneOff size={26} />
            </button>
          </>
        )}
      </div>
    </div>
  );
}
