import { messageText, type Message } from "@persona/shared";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import * as Clipboard from "expo-clipboard";
import { router, useLocalSearchParams } from "expo-router";
import {
  ArrowLeft,
  ArrowUp,
  Brain,
  Copy,
  Flag,
  MoreVertical,
  Pencil,
  Phone,
  Pin,
  PinOff,
  Plus,
  RotateCcw,
  Square,
  Trash2,
  UserRound,
  Users,
  Volume2,
  VolumeX,
} from "lucide-react-native";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  FlatList,
  KeyboardAvoidingView,
  Pressable,
  ScrollView,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { MessageItem, TypingDots, type Speaker } from "../../../components/Message";
import { MicButton } from "../../../components/MicButton";
import { PersonaPicker, usePersonas } from "../../../components/Personas";
import {
  Avatar,
  Button,
  Chip,
  EmptyState,
  Field,
  IconButton,
  Loading,
  Sheet,
  SheetItem,
  T,
  useToast,
} from "../../../components/ui";
import { useChatSession } from "../../../hooks/useChatSession";
import { api, chatSocket, errorText } from "../../../lib/api";
import { useAuth } from "../../../lib/auth";
import { font, radius, useTheme } from "../../../lib/theme";
import { useCaps, useVoicePlayer, voicePlayer } from "../../../lib/voice";

type SheetKind = "menu" | "message" | "edit" | "memory" | "persona" | "report" | "delete" | null;

export default function ChatRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  // Keyed so switching chats (e.g. "New chat") starts from fresh state.
  return <ChatScreen key={id} chatId={id} />;
}

function ChatScreen({ chatId }: { chatId: string }) {
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const qc = useQueryClient();
  const { user, setUser } = useAuth();
  const s = useChatSession(chatId);
  const caps = useCaps();
  const voice = useVoicePlayer();
  const [draft, setDraft] = useState("");
  const [sheet, setSheet] = useState<SheetKind>(null);
  const [target, setTarget] = useState<Message | null>(null);
  const [editText, setEditText] = useState("");
  const [reportText, setReportText] = useState("");

  const character = s.detail?.character ?? null;
  const room = s.detail?.room ?? null;
  const title = character?.name ?? room?.name ?? s.detail?.title ?? "";
  const tts = !!caps.data?.tts;
  const personas = usePersonas();
  const personaName =
    personas.data?.find((p) => p.id === s.detail?.persona_id)?.name ??
    user?.display_name ??
    user?.username;
  const autoplay = !!user?.preferences?.autoplay_voice;

  const speakers = useMemo(() => {
    const map = new Map<string, Speaker>();
    if (character) map.set(character.id, { name: character.name, avatar: character.avatar_url });
    room?.members.forEach((m) =>
      map.set(m.character_id, { name: m.character.name, avatar: m.character.avatar_url }),
    );
    return map;
  }, [character, room]);
  const speakerFor = useCallback(
    (m: Message): Speaker =>
      (m.character_id && speakers.get(m.character_id)) || {
        name: title || "Character",
        avatar: null,
      },
    [speakers, title],
  );

  // Auto-play finished replies in this chat.
  useEffect(() => {
    if (!tts || !autoplay) return;
    return chatSocket.on((ev) => {
      if (ev.type === "done" && ev.message.chat_id === chatId && !ev.filtered)
        void voicePlayer.playMessage(ev.message.id).catch(() => {});
    });
  }, [chatId, tts, autoplay]);
  useEffect(() => () => voicePlayer.stop(), [chatId]);

  const memories = useQuery({
    queryKey: ["memories", chatId],
    queryFn: () => api.memories(chatId),
    enabled: sheet === "memory",
  });
  const [memoryDraft, setMemoryDraft] = useState("");

  const data = useMemo(() => [...s.messages].reverse(), [s.messages]); // inverted list
  const lastId = s.messages.at(-1)?.id;

  const send = () => {
    if (!draft.trim() || s.busy) return;
    s.send(draft);
    setDraft("");
  };

  const openMessage = (m: Message) => {
    setTarget(m);
    setSheet("message");
  };

  if (s.loadError)
    return (
      <EmptyState
        title="This chat couldn't be opened"
        body={s.loadError}
        action={<Button label="Go back" variant="secondary" onPress={() => router.back()} />}
      />
    );

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: c.bg }} behavior="padding">
      {/* header */}
      <View
        style={{
          paddingTop: insets.top,
          paddingHorizontal: 4,
          flexDirection: "row",
          alignItems: "center",
          borderBottomWidth: 1,
          borderBottomColor: c.line,
          minHeight: insets.top + 56,
        }}
      >
        <IconButton label="Back" onPress={() => router.back()}>
          <ArrowLeft size={22} color={c.ink} />
        </IconButton>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={character ? `About ${character.name}` : room ? "Edit room" : title}
          onPress={() =>
            character
              ? router.push(`/character/${character.id}`)
              : room
                ? router.push(`/room/${room.id}`)
                : undefined
          }
          style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: 10, minWidth: 0 }}
        >
          {room ? (
            <View style={{ flexDirection: "row" }}>
              {room.members.slice(0, 3).map((m, i) => (
                <View key={m.character_id} style={{ marginLeft: i ? -12 : 0 }}>
                  <Avatar src={m.character.avatar_url} name={m.character.name} size={32} ring />
                </View>
              ))}
            </View>
          ) : (
            <Avatar src={character?.avatar_url} name={title || "?"} size={36} />
          )}
          <View style={{ flex: 1, minWidth: 0 }}>
            <T weight="bold" numberOfLines={1}>
              {title}
            </T>
            <T size="xs" tone="ink3" numberOfLines={1}>
              {room
                ? `${room.members.length} characters`
                : character?.creator
                  ? `By @${character.creator.username}`
                  : ""}
            </T>
          </View>
        </Pressable>
        {tts && (
          <IconButton
            label={autoplay ? "Turn off auto-play" : "Turn on auto-play"}
            active={autoplay}
            onPress={async () => {
              if (autoplay) voicePlayer.stop();
              setUser(await api.updateMe({ preferences: { autoplay_voice: !autoplay } }));
            }}
          >
            {autoplay ? (
              <Volume2 size={20} color={c.ember} />
            ) : (
              <VolumeX size={20} color={c.ink2} />
            )}
          </IconButton>
        )}
        {caps.data?.calls && character && (
          <IconButton
            label={`Call ${character.name}`}
            onPress={() => router.push(`/call/${chatId}`)}
          >
            <Phone size={20} color={c.ink} />
          </IconButton>
        )}
        <IconButton label="Chat options" onPress={() => setSheet("menu")}>
          <MoreVertical size={20} color={c.ink} />
        </IconButton>
      </View>

      {/* messages */}
      {s.loading && !s.messages.length ? (
        <Loading />
      ) : (
        <FlatList
          inverted
          data={data}
          keyExtractor={(m) => m.id}
          contentContainerStyle={{ padding: 14, gap: 16 }}
          keyboardDismissMode="interactive"
          keyboardShouldPersistTaps="handled"
          onEndReached={() => s.hasMore && void s.loadOlder()}
          onEndReachedThreshold={0.4}
          ListHeaderComponent={s.typing ? <TypingDots name={s.typing.name} /> : undefined}
          ListFooterComponent={
            character ? (
              <View style={{ alignItems: "center", paddingVertical: 16, gap: 4 }}>
                <Avatar src={character.avatar_url} name={character.name} size={64} />
                <T weight="bold">{character.name}</T>
                {character.tagline ? (
                  <T size="sm" tone="ink2" style={{ textAlign: "center", maxWidth: 300 }}>
                    {character.tagline}
                  </T>
                ) : null}
              </View>
            ) : undefined
          }
          renderItem={({ item: m }) => {
            const key = `m:${m.id}`;
            return (
              <MessageItem
                m={m}
                speaker={speakerFor(m)}
                isLast={m.id === lastId}
                streaming={!!s.streamingId && m.selected_candidate_id === s.streamingId}
                busy={s.busy}
                playing={
                  tts && m.role === "assistant"
                    ? voice.loading === key
                      ? "loading"
                      : voice.playing === key
                        ? "playing"
                        : "idle"
                    : null
                }
                onSwipe={s.swipe}
                onRate={s.rate}
                onLongPress={openMessage}
                onPlay={(msg) =>
                  void voicePlayer.playMessage(msg.id).catch((e) => toast(errorText(e), "error"))
                }
              />
            );
          }}
        />
      )}

      {/* room speaker chips */}
      {room && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ gap: 6, paddingHorizontal: 12, paddingTop: 8 }}
          style={{ flexGrow: 0 }}
        >
          {room.members.map((m) => (
            <Chip
              key={m.character_id}
              label={m.character.name}
              onPress={() => !s.busy && s.nextTurn(m.character_id)}
            />
          ))}
          <Chip label="Anyone" onPress={() => !s.busy && s.nextTurn()} />
        </ScrollView>
      )}

      {/* composer */}
      <View
        style={{
          flexDirection: "row",
          alignItems: "flex-end",
          gap: 4,
          paddingHorizontal: 10,
          paddingTop: 8,
          paddingBottom: Math.max(insets.bottom, 10),
        }}
      >
        <View
          style={{
            flex: 1,
            flexDirection: "row",
            alignItems: "flex-end",
            backgroundColor: c.surface,
            borderRadius: radius.bubble,
            borderWidth: 1,
            borderColor: c.line,
            paddingLeft: 14,
            paddingRight: 4,
            minHeight: 46,
          }}
        >
          <TextInput
            value={draft}
            onChangeText={setDraft}
            placeholder={room ? "Message the room" : `Message ${title}`}
            placeholderTextColor={c.ink3}
            accessibilityLabel="Message"
            multiline
            maxLength={8000}
            style={{
              flex: 1,
              color: c.ink,
              fontFamily: font.regular,
              fontSize: 16,
              maxHeight: 140,
              paddingTop: 12,
              paddingBottom: 12,
            }}
          />
          {caps.data?.stt && <MicButton onText={(t) => setDraft((d) => (d ? `${d} ${t}` : t))} />}
        </View>
        {s.busy ? (
          <IconButton
            label="Stop generating"
            onPress={s.stop}
            size={46}
            style={{ backgroundColor: c.surface2 }}
          >
            <Square size={16} color={c.ink} fill={c.ink} />
          </IconButton>
        ) : (
          <IconButton
            label="Send message"
            onPress={send}
            disabled={!draft.trim()}
            size={46}
            style={{ backgroundColor: draft.trim() ? c.ember : c.surface2 }}
          >
            <ArrowUp size={22} color={draft.trim() ? c.emberInk : c.ink3} />
          </IconButton>
        )}
      </View>

      {/* chat menu */}
      <Sheet open={sheet === "menu"} onClose={() => setSheet(null)} title="Chat">
        {character && (
          <SheetItem
            label="New chat"
            icon={<Plus size={20} color={c.ink2} />}
            onPress={async () => {
              setSheet(null);
              try {
                const chat = await api.createChat({ character_id: character.id });
                void qc.invalidateQueries({ queryKey: ["chats"] });
                router.replace(`/chat/${chat.id}`);
              } catch (e) {
                toast(errorText(e), "error");
              }
            }}
          />
        )}
        <SheetItem
          label={`Talking as ${personaName}`}
          icon={<UserRound size={20} color={c.ink2} />}
          onPress={() => setSheet("persona")}
        />
        <SheetItem
          label="Memory"
          icon={<Brain size={20} color={c.ink2} />}
          onPress={() => setSheet("memory")}
        />
        {room && (
          <SheetItem
            label="Edit room"
            icon={<Users size={20} color={c.ink2} />}
            onPress={() => {
              setSheet(null);
              router.push(`/room/${room.id}`);
            }}
          />
        )}
        <SheetItem
          label="Delete chat"
          danger
          icon={<Trash2 size={20} color={c.err} />}
          onPress={() => setSheet("delete")}
        />
      </Sheet>

      <Sheet open={sheet === "delete"} onClose={() => setSheet(null)} title="Delete this chat?">
        <View style={{ gap: 12, paddingBottom: 8 }}>
          <T tone="ink2">All messages and memories in it are deleted. This can&apos;t be undone.</T>
          <Button
            label="Delete chat"
            variant="danger"
            onPress={async () => {
              try {
                await api.deleteChat(chatId);
                void qc.invalidateQueries({ queryKey: ["chats"] });
                setSheet(null);
                router.back();
              } catch (e) {
                toast(errorText(e), "error");
              }
            }}
          />
        </View>
      </Sheet>

      {/* message actions */}
      <Sheet open={sheet === "message" && !!target} onClose={() => setSheet(null)}>
        {target && (
          <>
            <SheetItem
              label="Copy text"
              icon={<Copy size={20} color={c.ink2} />}
              onPress={async () => {
                await Clipboard.setStringAsync(messageText(target));
                setSheet(null);
                toast("Copied");
              }}
            />
            <SheetItem
              label="Edit"
              icon={<Pencil size={20} color={c.ink2} />}
              onPress={() => {
                setEditText(messageText(target));
                setSheet("edit");
              }}
            />
            <SheetItem
              label={target.is_pinned ? "Unpin from memory" : "Pin to memory"}
              icon={
                target.is_pinned ? (
                  <PinOff size={20} color={c.ink2} />
                ) : (
                  <Pin size={20} color={c.ink2} />
                )
              }
              onPress={() => {
                setSheet(null);
                void s.togglePin(target);
              }}
            />
            {target.role === "user" && target.id !== lastId && (
              <SheetItem
                label="Rewind to here"
                icon={<RotateCcw size={20} color={c.ink2} />}
                onPress={() => {
                  setSheet(null);
                  const next = s.messages.find((x) => x.position > target.position);
                  if (next) void s.remove(next, true);
                }}
              />
            )}
            {target.role === "assistant" && (
              <SheetItem
                label="Report reply"
                icon={<Flag size={20} color={c.ink2} />}
                onPress={() => {
                  setReportText("");
                  setSheet("report");
                }}
              />
            )}
            <SheetItem
              label="Delete message"
              danger
              icon={<Trash2 size={20} color={c.err} />}
              onPress={() => {
                setSheet(null);
                void s.remove(target);
              }}
            />
          </>
        )}
      </Sheet>

      <Sheet open={sheet === "edit"} onClose={() => setSheet(null)} title="Edit message">
        <View style={{ gap: 12, paddingBottom: 8 }}>
          <Field
            value={editText}
            onChangeText={setEditText}
            multiline
            autoFocus
            style={{ minHeight: 140 }}
          />
          <Button
            label="Save"
            disabled={!editText.trim()}
            onPress={() => {
              if (target) void s.edit(target, editText);
              setSheet(null);
            }}
          />
        </View>
      </Sheet>

      <Sheet open={sheet === "report"} onClose={() => setSheet(null)} title="Report this reply">
        <View style={{ gap: 12, paddingBottom: 8 }}>
          <Field
            value={reportText}
            onChangeText={setReportText}
            multiline
            placeholder="What's wrong with it?"
          />
          <Button
            label="Send report"
            disabled={reportText.trim().length < 3}
            onPress={async () => {
              try {
                if (target) await api.report("message", target.id, reportText.trim());
                setSheet(null);
                toast("Thanks, the admins will take a look.", "success");
              } catch (e) {
                toast(errorText(e), "error");
              }
            }}
          />
        </View>
      </Sheet>

      <Sheet open={sheet === "memory"} onClose={() => setSheet(null)} title="Memory">
        <View style={{ gap: 12, paddingBottom: 8 }}>
          <T size="sm" tone="ink2">
            Things the character always remembers in this chat. Long-press a message to pin it.
          </T>
          {memories.isLoading ? (
            <Loading />
          ) : (
            (memories.data ?? [])
              .filter((m) => m.kind === "pinned")
              .map((m) => (
                <View
                  key={m.id}
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 8,
                    backgroundColor: c.surface,
                    borderRadius: radius.control,
                    padding: 10,
                  }}
                >
                  <T size="sm" style={{ flex: 1 }}>
                    {m.content}
                  </T>
                  <IconButton
                    label="Forget this"
                    size={36}
                    onPress={async () => {
                      await api.deleteMemory(m.id);
                      void memories.refetch();
                    }}
                  >
                    <Trash2 size={16} color={c.ink3} />
                  </IconButton>
                </View>
              ))
          )}
          {(memories.data ?? []).some((m) => m.kind === "summary") && (
            <T size="xs" tone="ink3">
              Older parts of this chat are summarised automatically.
            </T>
          )}
          <Field
            value={memoryDraft}
            onChangeText={setMemoryDraft}
            placeholder="Add something to remember"
            multiline
          />
          <Button
            label="Add memory"
            variant="secondary"
            disabled={!memoryDraft.trim()}
            onPress={async () => {
              try {
                await api.addMemory(chatId, memoryDraft.trim());
                setMemoryDraft("");
                void memories.refetch();
              } catch (e) {
                toast(errorText(e), "error");
              }
            }}
          />
        </View>
      </Sheet>

      <PersonaPicker
        open={sheet === "persona"}
        onClose={() => setSheet(null)}
        current={s.detail?.persona_id ?? null}
        onPick={async (pid) => {
          try {
            await api.updateChat(chatId, { persona_id: pid });
            setSheet(null);
            await s.reload();
          } catch (e) {
            toast(errorText(e), "error");
          }
        }}
      />
    </KeyboardAvoidingView>
  );
}
