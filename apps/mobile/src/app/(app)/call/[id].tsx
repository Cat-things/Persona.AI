import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useKeepAwake } from "expo-keep-awake";
import { router, useLocalSearchParams } from "expo-router";
import { Mic, MicOff, Phone, PhoneOff } from "lucide-react-native";
import { useEffect, useRef, useState } from "react";
import { Animated, Pressable, ScrollView, View, type ScrollViewInstance } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Avatar, T } from "../../../components/ui";
import { api } from "../../../lib/api";
import { CallClient, type CallState } from "../../../lib/callClient";
import { useTheme } from "../../../lib/theme";

interface Line {
  who: "you" | "them";
  text: string;
  live?: boolean;
}

const LABEL: Record<CallState, string> = {
  connecting: "Connecting…",
  listening: "Listening",
  thinking: "Thinking…",
  speaking: "Speaking",
  ended: "Call ended",
  error: "Call failed",
};

const fmt = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

export default function CallScreen() {
  useKeepAwake();
  const { id: chatId } = useLocalSearchParams<{ id: string }>();
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const chat = useQuery({ queryKey: ["chat-head", chatId], queryFn: () => api.chat(chatId) });
  const ch = chat.data?.character;
  const name = ch?.name ?? "";
  const [started, setStarted] = useState(false);
  const [state, setState] = useState<CallState>("connecting");
  const [muted, setMuted] = useState(false);
  const [userSpeaking, setUserSpeaking] = useState(false);
  const [lines, setLines] = useState<Line[]>([]);
  const [error, setError] = useState("");
  const [seconds, setSeconds] = useState(0);
  const [latency, setLatency] = useState<number | null>(null);
  const client = useRef<CallClient | null>(null);
  const scroller = useRef<ScrollViewInstance>(null);
  const [ring] = useState(() => new Animated.Value(1));
  const level = useRef(0);

  useEffect(() => {
    if (!started || state === "ended" || state === "error") return;
    const t = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [started, state]);

  useEffect(() => () => client.current?.hangup(), []);

  useEffect(() => {
    const target =
      state === "speaking" ? 1.12 : userSpeaking ? 1 + Math.min(0.18, level.current * 0.6) : 1;
    Animated.timing(ring, { toValue: target, duration: 150, useNativeDriver: true }).start();
  }, [state, userSpeaking, ring]);

  const upsert = (who: Line["who"], text: string, live: boolean, append = false) =>
    setLines((ls) => {
      const last = ls.at(-1);
      if (last && last.who === who && last.live)
        return [...ls.slice(0, -1), { who, text: append ? last.text + text : text, live }];
      return [...ls.slice(-30), { who, text, live }];
    });

  const start = async () => {
    setStarted(true);
    setError("");
    const cl = new CallClient(chatId)
      .on("state", setState)
      .on("userSpeaking", setUserSpeaking)
      .on("level", (v) => (level.current = v))
      .on("partial", (t) => upsert("you", t, true))
      .on("userText", (t) => upsert("you", t, false))
      .on("botDelta", (t) => upsert("them", t, true, true))
      .on("botText", (t) => upsert("them", t, false))
      .on("metrics", (m) => m.first_audio_ms && setLatency(m.first_audio_ms))
      .on("error", (d, fatal) => {
        setError(d);
        if (fatal) setState("error");
      });
    client.current = cl;
    try {
      await cl.start();
    } catch (e) {
      setState("error");
      setError(e instanceof Error ? e.message : "Couldn't start the call");
      cl.hangup();
    }
  };

  const hangup = () => {
    client.current?.hangup();
    void qc.invalidateQueries({ queryKey: ["chats"] });
    router.back();
  };

  const live = started && state !== "ended" && state !== "error";
  const round = (bg: string) => ({
    width: 68,
    height: 68,
    borderRadius: 34,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    backgroundColor: bg,
  });

  return (
    <View
      style={{
        flex: 1,
        backgroundColor: c.bg,
        paddingTop: insets.top + 16,
        paddingBottom: insets.bottom + 20,
        alignItems: "center",
      }}
    >
      <T
        size="sm"
        tone="ink3"
        accessibilityLiveRegion="polite"
        style={{ fontVariant: ["tabular-nums"] }}
      >
        {started ? `${LABEL[state]} · ${fmt(seconds)}` : "Voice call"}
      </T>

      <View
        style={{
          flex: 1,
          width: "100%",
          alignItems: "center",
          justifyContent: "center",
          gap: 18,
          paddingHorizontal: 20,
        }}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={state === "speaking" ? `Interrupt ${name}` : name}
          disabled={state !== "speaking"}
          onPress={() => client.current?.interrupt()}
        >
          <Animated.View
            style={{
              position: "absolute",
              top: -10,
              left: -10,
              right: -10,
              bottom: -10,
              borderRadius: 999,
              backgroundColor:
                state === "speaking" ? c.emberSoft : userSpeaking ? c.surface2 : "transparent",
              borderWidth: state === "speaking" ? 2 : 0,
              borderColor: c.ember,
              transform: [{ scale: ring }],
            }}
          />
          <Avatar src={ch?.avatar_url} name={name || "?"} size={168} />
        </Pressable>
        <View style={{ alignItems: "center", gap: 4 }}>
          <T size="2xl" weight="bold">
            {name}
          </T>
          {state === "speaking" && (
            <T size="xs" tone="ink3">
              Tap the avatar or just start talking to interrupt
            </T>
          )}
          {latency !== null && (
            <T size="xs" tone="ink3">
              first reply audio in {(latency / 1000).toFixed(2)} s
            </T>
          )}
        </View>
        <ScrollView
          ref={scroller}
          style={{ maxHeight: 220, width: "100%" }}
          contentContainerStyle={{ gap: 8 }}
          onContentSizeChange={() => scroller.current?.scrollToEnd({ animated: true })}
          accessibilityLabel="Live transcript"
        >
          {lines.map((l, i) => (
            <T
              key={i}
              size="sm"
              tone={l.who === "you" ? "ink2" : "ink"}
              style={{ textAlign: l.who === "you" ? "right" : "left", opacity: l.live ? 0.7 : 1 }}
            >
              {l.who === "them" ? (
                <T size="sm" weight="semibold">
                  {name}:{" "}
                </T>
              ) : null}
              {l.text}
            </T>
          ))}
        </ScrollView>
        {error ? (
          <T size="sm" tone="err" style={{ textAlign: "center" }} accessibilityRole="alert">
            {error}
          </T>
        ) : null}
      </View>

      <View style={{ flexDirection: "row", gap: 28 }}>
        {!started || state === "error" ? (
          <>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Back to chat"
              onPress={() => router.back()}
              style={round(c.surface2)}
            >
              <PhoneOff size={26} color={c.ink} />
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={state === "error" ? "Try again" : `Call ${name}`}
              onPress={start}
              style={round(c.ok)}
            >
              <Phone size={28} color={c.bg} />
            </Pressable>
          </>
        ) : (
          <>
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ selected: muted, disabled: !live }}
              accessibilityLabel={muted ? "Unmute microphone" : "Mute microphone"}
              disabled={!live}
              onPress={() => {
                setMuted(!muted);
                client.current?.setMuted(!muted);
              }}
              style={round(muted ? c.ink : c.surface2)}
            >
              {muted ? <MicOff size={26} color={c.bg} /> : <Mic size={26} color={c.ink} />}
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Hang up"
              onPress={hangup}
              style={round(c.err)}
            >
              <PhoneOff size={28} color="#fff" />
            </Pressable>
          </>
        )}
      </View>
    </View>
  );
}
