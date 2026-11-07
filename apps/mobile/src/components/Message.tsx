import { messageText, type Message } from "@persona/shared";
import * as Haptics from "expo-haptics";
import { ChevronLeft, ChevronRight, Loader2, Square, Star, Volume2 } from "lucide-react-native";
import { memo, type ReactNode } from "react";
import { Pressable, Text, View } from "react-native";
import { font, radius, useTheme, type Colors } from "../lib/theme";
import { Avatar, T } from "./ui";

export interface Speaker {
  name: string;
  avatar: string | null;
}

/** *action* / _italic_ -> italic muted, **bold** -> bold. Produces Text nodes only. */
const TOKEN = /(\*\*[^*\n]+\*\*|\*[^*\n]+\*|_[^_\n]+_)/g;
export function Markup({ text, c, color }: { text: string; c: Colors; color: string }) {
  const parts = text.split(TOKEN);
  return (
    <Text style={{ color, fontFamily: font.regular, fontSize: 16, lineHeight: 24 }} selectable>
      {parts.map((p, i) => {
        if (!p) return null;
        if (p.startsWith("**") && p.endsWith("**") && p.length > 4)
          return (
            <Text key={i} style={{ fontFamily: font.bold }}>
              {p.slice(2, -2)}
            </Text>
          );
        if (
          ((p.startsWith("*") && p.endsWith("*")) || (p.startsWith("_") && p.endsWith("_"))) &&
          p.length > 2
        )
          return (
            <Text key={i} style={{ fontStyle: "italic", color: c.ink2 }}>
              {p.slice(1, -1)}
            </Text>
          );
        return p;
      })}
    </Text>
  );
}

export function StarRating({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const { c } = useTheme();
  return (
    <View
      style={{ flexDirection: "row" }}
      accessibilityRole="radiogroup"
      accessibilityLabel="Rate this reply"
    >
      {[1, 2, 3, 4].map((n) => (
        <Pressable
          key={n}
          accessibilityRole="radio"
          accessibilityState={{ checked: value === n }}
          accessibilityLabel={`${n} star${n > 1 ? "s" : ""}`}
          hitSlop={4}
          style={{ padding: 5 }}
          onPress={() => {
            void Haptics.selectionAsync();
            onChange(value === n ? 0 : n);
          }}
        >
          <Star
            size={18}
            color={n <= value ? c.star : c.ink3}
            fill={n <= value ? c.star : "none"}
          />
        </Pressable>
      ))}
    </View>
  );
}

interface Props {
  m: Message;
  speaker: Speaker;
  isLast: boolean;
  streaming: boolean;
  busy: boolean;
  playing: "idle" | "loading" | "playing" | null; // null = no voice available
  onSwipe: (m: Message, dir: -1 | 1) => void;
  onRate: (m: Message, r: number) => void;
  onLongPress: (m: Message) => void;
  onPlay: (m: Message) => void;
}

function MessageItemInner({
  m,
  speaker,
  isLast,
  streaming,
  busy,
  playing,
  onSwipe,
  onRate,
  onLongPress,
  onPlay,
}: Props) {
  const { c } = useTheme();
  const mine = m.role === "user";
  const text = messageText(m);
  const idx = m.candidates.findIndex((x) => x.id === m.selected_candidate_id);
  const sel = m.candidates[idx];
  const showSwipes = !mine && isLast && m.position > 0;
  const tmp = m.id.startsWith("tmp-");

  let body: ReactNode;
  if (!text && streaming) {
    body = <T tone="ink3">…</T>;
  } else {
    body = <Markup text={text} c={c} color={c.ink} />;
  }

  return (
    <View
      style={{ flexDirection: mine ? "row-reverse" : "row", gap: 10, alignItems: "flex-start" }}
    >
      {!mine && <Avatar src={speaker.avatar} name={speaker.name} size={34} />}
      <View style={{ flex: 1, alignItems: mine ? "flex-end" : "flex-start", gap: 4 }}>
        {!mine && (
          <T size="xs" weight="semibold" tone="ink2">
            {speaker.name}
            {m.is_pinned ? "  · pinned" : ""}
          </T>
        )}
        <Pressable
          onLongPress={() => {
            if (tmp) return;
            void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            onLongPress(m);
          }}
          delayLongPress={300}
          accessibilityHint="Long press for message options"
          style={{
            maxWidth: "92%",
            paddingHorizontal: 14,
            paddingVertical: 10,
            borderRadius: radius.bubble,
            borderTopLeftRadius: mine ? radius.bubble : 6,
            borderTopRightRadius: mine ? 6 : radius.bubble,
            backgroundColor: mine ? c.userBubble : c.surface,
            opacity: tmp ? 0.7 : 1,
          }}
        >
          {body}
        </Pressable>

        {!mine && !streaming && !tmp && (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 2, marginLeft: -4 }}>
            {showSwipes && (
              <>
                <Pressable
                  accessibilityLabel="Previous reply"
                  disabled={idx <= 0 || busy}
                  onPress={() => onSwipe(m, -1)}
                  hitSlop={6}
                  style={{ padding: 6, opacity: idx <= 0 ? 0.35 : 1 }}
                >
                  <ChevronLeft size={18} color={c.ink2} />
                </Pressable>
                <T size="xs" tone="ink3" style={{ fontVariant: ["tabular-nums"] }}>
                  {idx + 1}/{m.candidates.length}
                </T>
                <Pressable
                  accessibilityLabel={
                    idx >= m.candidates.length - 1 ? "Generate a new reply" : "Next reply"
                  }
                  disabled={busy}
                  onPress={() => onSwipe(m, 1)}
                  hitSlop={6}
                  style={{ padding: 6 }}
                >
                  <ChevronRight size={18} color={c.ink2} />
                </Pressable>
              </>
            )}
            {m.position > 0 && sel && (
              <StarRating value={sel.rating} onChange={(r) => onRate(m, r)} />
            )}
            {playing && (
              <Pressable
                accessibilityLabel={playing === "playing" ? "Stop reading aloud" : "Read aloud"}
                onPress={() => onPlay(m)}
                hitSlop={6}
                style={{ padding: 6 }}
              >
                {playing === "loading" ? (
                  <Loader2 size={17} color={c.ink2} />
                ) : playing === "playing" ? (
                  <Square size={14} color={c.ember} fill={c.ember} />
                ) : (
                  <Volume2 size={17} color={c.ink2} />
                )}
              </Pressable>
            )}
          </View>
        )}
      </View>
    </View>
  );
}

export const MessageItem = memo(MessageItemInner);

export function TypingDots({ name }: { name: string }) {
  return (
    <T size="sm" tone="ink3" accessibilityLiveRegion="polite" style={{ paddingLeft: 44 }}>
      {name} is typing…
    </T>
  );
}
