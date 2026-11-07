import type { Character, ChatEvent, Message, Room } from "@persona/shared";
import { Loader2, MessageSquarePlus, Square, UserRound, Volume2, VolumeX } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { useNavigate } from "react-router";
import { MicButton } from "../components/MicButton";
import { PersonaPicker, usePersonas } from "../components/Personas";
import type { useChatSession } from "../hooks/useChatSession";
import { api, chatSocket } from "../lib/api";
import { useAuth } from "../lib/auth";
import { errorText, useToast } from "../lib/toast";
import { useCaps, useVoicePlayer, voicePlayer } from "../lib/voice";

export interface ChatExtras {
  headerActions?: ReactNode;
  menuItems?: (close: () => void) => ReactNode;
  messageActions?: (m: Message) => ReactNode;
  aboveComposer?: ReactNode;
  micSlot?: (append: (text: string) => void) => ReactNode;
  onCall?: () => void;
  overlay?: ReactNode;
}

function PlayButton({ m }: { m: Message }) {
  const st = useVoicePlayer();
  const toast = useToast();
  const key = `m:${m.id}`;
  return (
    <button
      className="icon-btn size-8"
      aria-label={st.playing === key ? "Stop reading aloud" : "Read aloud"}
      onClick={() => voicePlayer.playMessage(m.id).catch((e) => toast(errorText(e), "error"))}
    >
      {st.loading === key ? (
        <Loader2 size={16} className="animate-spin" />
      ) : st.playing === key ? (
        <Square size={13} fill="currentColor" />
      ) : (
        <Volume2 size={16} />
      )}
    </button>
  );
}

/** Feature hooks for the chat view (voice, calls, rooms). */
export function useChatExtras({
  chatId,
  room,
  session,
}: {
  chatId: string;
  character: Character | null;
  room: Room | null;
  session: ReturnType<typeof useChatSession>;
}): ChatExtras {
  const caps = useCaps();
  const { user, setUser } = useAuth();
  const autoplay = !!user?.preferences?.autoplay_voice;
  const tts = !!caps.data?.tts;

  // Auto-play finished replies in this chat.
  useEffect(() => {
    if (!tts || !autoplay) return;
    return chatSocket.on((ev: ChatEvent) => {
      if (ev.type === "done" && ev.message.chat_id === chatId && !ev.filtered) {
        void voicePlayer.playMessage(ev.message.id).catch(() => {});
      }
    });
  }, [chatId, tts, autoplay]);

  useEffect(() => () => voicePlayer.stop(), [chatId]);

  const navigate = useNavigate();
  const toast = useToast();
  const [pickPersona, setPickPersona] = useState(false);
  const personas = usePersonas();
  const personaId = session.detail?.persona_id ?? null;
  const personaName =
    personas.data?.find((p) => p.id === personaId)?.name ?? user?.display_name ?? user?.username;
  const extras: ChatExtras = {};
  extras.menuItems = (close) => (
    <button
      className="menu-item"
      onClick={() => {
        close();
        setPickPersona(true);
      }}
    >
      <UserRound size={16} /> Talking as {personaName}
    </button>
  );
  extras.overlay = (
    <PersonaPicker
      open={pickPersona}
      onClose={() => setPickPersona(false)}
      current={personaId}
      onPick={async (id) => {
        try {
          await api.updateChat(chatId, { persona_id: id });
          setPickPersona(false);
          await session.reload();
        } catch (e) {
          toast(errorText(e), "error");
        }
      }}
    />
  );
  if (caps.data?.stt) extras.micSlot = (append) => <MicButton onText={append} />;
  if (caps.data?.calls && !room) extras.onCall = () => navigate(`/call/${chatId}`);
  if (tts) {
    extras.messageActions = (m) =>
      m.role === "assistant" && !m.id.startsWith("tmp-") ? <PlayButton m={m} /> : null;
    extras.headerActions = (
      <button
        className="icon-btn size-10"
        aria-pressed={autoplay}
        aria-label={autoplay ? "Turn off auto-play" : "Turn on auto-play"}
        title={autoplay ? "Auto-play on" : "Auto-play off"}
        onClick={async () => {
          if (autoplay) voicePlayer.stop();
          setUser(await api.updateMe({ preferences: { autoplay_voice: !autoplay } }));
        }}
      >
        {autoplay ? <Volume2 size={18} className="text-ember" /> : <VolumeX size={18} />}
      </button>
    );
  }
  if (room) {
    extras.aboveComposer = (
      <div className="flex flex-wrap items-center gap-2 mb-2">
        <span className="text-xs text-ink-3">Let someone speak:</span>
        {room.members.map((m) => (
          <button
            key={m.character_id}
            className="chip h-7 text-xs"
            disabled={session.busy}
            onClick={() => session.nextTurn(m.character_id)}
          >
            {m.character.name}
          </button>
        ))}
        <button
          className="chip h-7 text-xs"
          disabled={session.busy}
          onClick={() => session.nextTurn()}
        >
          <MessageSquarePlus size={13} /> Anyone
        </button>
      </div>
    );
  }
  return extras;
}
