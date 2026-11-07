import type { CharacterCard, Room } from "@persona/shared";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { router, useLocalSearchParams } from "expo-router";
import { ArrowLeft, Check, X } from "lucide-react-native";
import { useMemo, useState } from "react";
import { KeyboardAvoidingView, Pressable, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  Avatar,
  Button,
  Field,
  IconButton,
  Loading,
  Sheet,
  T,
  useToast,
} from "../../../components/ui";
import { api, errorText } from "../../../lib/api";
import { radius, useTheme } from "../../../lib/theme";

const MAX = 8;
const MODES: { id: Room["turn_mode"]; label: string; hint: string }[] = [
  {
    id: "auto",
    label: "Natural",
    hint: "Whoever you name answers; otherwise someone who hasn't spoken lately.",
  },
  { id: "round_robin", label: "Take turns", hint: "Characters answer in order." },
  { id: "manual", label: "You choose", hint: "Nobody answers until you pick who speaks." },
];

export default function RoomRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const editing = id !== "new";
  const existing = useQuery({
    queryKey: ["room", id],
    queryFn: () => api.room(id),
    enabled: editing,
  });
  if (editing && existing.isLoading) return <Loading />;
  return <RoomEditor key={id} id={id} initial={existing.data} />;
}

function RoomEditor({ id, initial }: { id: string; initial?: Room }) {
  const editing = id !== "new";
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const qc = useQueryClient();
  const [name, setName] = useState(initial?.name ?? "");
  const [topic, setTopic] = useState(initial?.topic ?? "");
  const [mode, setMode] = useState<Room["turn_mode"]>(initial?.turn_mode ?? "auto");
  const [picked, setPicked] = useState<CharacterCard[]>(
    () => initial?.members.map((m) => m.character) ?? [],
  );
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const mine = useQuery({ queryKey: ["characters", "mine"], queryFn: () => api.myCharacters() });
  const liked = useQuery({
    queryKey: ["characters", "liked"],
    queryFn: () => api.likedCharacters(),
  });
  const search = useQuery({
    queryKey: ["discover", "room-picker", q],
    queryFn: () => api.discover({ q: q.trim() || undefined, sort: "popular", limit: 30 }),
  });
  const pool = useMemo(() => {
    const seen = new Set<string>();
    const out: CharacterCard[] = [];
    const needle = q.trim().toLowerCase();
    for (const list of [mine.data, liked.data, search.data?.items])
      for (const ch of list ?? []) {
        if (seen.has(ch.id) || (needle && !ch.name.toLowerCase().includes(needle))) continue;
        seen.add(ch.id);
        out.push(ch);
      }
    return out;
  }, [mine.data, liked.data, search.data, q]);

  const toggle = (ch: CharacterCard) =>
    setPicked((ps) =>
      ps.some((p) => p.id === ch.id)
        ? ps.filter((p) => p.id !== ch.id)
        : ps.length >= MAX
          ? ps
          : [...ps, ch],
    );
  const valid = !!name.trim() && picked.length >= 2;

  const save = async () => {
    setBusy(true);
    const body = {
      name: name.trim(),
      topic: topic.trim(),
      turn_mode: mode,
      character_ids: picked.map((p) => p.id),
    };
    try {
      if (editing) {
        await api.updateRoom(id, body);
        void qc.invalidateQueries({ queryKey: ["chats"] });
        void qc.invalidateQueries({ queryKey: ["room", id] });
        toast("Room saved", "success");
        router.back();
      } else {
        const r = await api.createRoom(body);
        void qc.invalidateQueries({ queryKey: ["chats"] });
        router.replace(`/chat/${r.chat_id}`);
      }
    } catch (e) {
      toast(errorText(e), "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
      <View
        style={{
          paddingTop: insets.top,
          paddingHorizontal: 8,
          flexDirection: "row",
          alignItems: "center",
          minHeight: insets.top + 52,
        }}
      >
        <IconButton label="Back" onPress={() => router.back()}>
          <ArrowLeft size={22} color={c.ink} />
        </IconButton>
        <T size="xl" weight="extrabold" style={{ paddingHorizontal: 8 }}>
          {editing ? "Edit room" : "New room"}
        </T>
      </View>
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ padding: 16, gap: 18, paddingBottom: insets.bottom + 40 }}
      >
        <T size="sm" tone="ink2">
          A group chat with two to {MAX} characters. Mention someone by name to have them answer.
        </T>
        <Field
          label="Room name"
          value={name}
          maxLength={64}
          placeholder="The night shift"
          onChangeText={setName}
        />
        <Field
          label="Setting"
          value={topic}
          maxLength={4000}
          multiline
          placeholder="Where are they, and what's going on? Every character sees this."
          onChangeText={setTopic}
        />
        <View style={{ gap: 8 }}>
          <T size="sm" weight="semibold" tone="ink2">
            Who answers
          </T>
          {MODES.map((m) => (
            <Pressable
              key={m.id}
              accessibilityRole="radio"
              accessibilityState={{ checked: mode === m.id }}
              onPress={() => setMode(m.id)}
              style={{
                padding: 12,
                borderRadius: radius.control,
                borderWidth: 1,
                borderColor: mode === m.id ? c.ember : c.line,
                backgroundColor: mode === m.id ? c.emberSoft : "transparent",
              }}
            >
              <T weight="semibold">{m.label}</T>
              <T size="xs" tone="ink2">
                {m.hint}
              </T>
            </Pressable>
          ))}
        </View>

        <View style={{ gap: 8 }}>
          <T size="sm" weight="semibold" tone="ink2">
            Characters ({picked.length}/{MAX})
          </T>
          {picked.length > 0 ? (
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
              {picked.map((ch, i) => (
                <Pressable
                  key={ch.id}
                  accessibilityLabel={`Remove ${ch.name}`}
                  onPress={() => toggle(ch)}
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 6,
                    backgroundColor: c.surface,
                    borderRadius: 999,
                    paddingLeft: 4,
                    paddingRight: 10,
                    height: 36,
                  }}
                >
                  <Avatar src={ch.avatar_url} name={ch.name} size={28} />
                  <T size="sm">
                    {i + 1}. {ch.name}
                  </T>
                  <X size={14} color={c.ink3} />
                </Pressable>
              ))}
            </View>
          ) : (
            <T size="xs" tone="ink3">
              Pick at least two.
            </T>
          )}
          <Field
            value={q}
            onChangeText={setQ}
            placeholder="Search characters"
            autoCorrect={false}
          />
          <View
            style={{
              borderRadius: radius.control,
              borderWidth: 1,
              borderColor: c.line,
              overflow: "hidden",
            }}
          >
            {pool.slice(0, 40).map((ch) => {
              const on = picked.some((p) => p.id === ch.id);
              const full = !on && picked.length >= MAX;
              return (
                <Pressable
                  key={ch.id}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: on, disabled: full }}
                  disabled={full}
                  onPress={() => toggle(ch)}
                  style={({ pressed }) => ({
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 10,
                    padding: 10,
                    opacity: full ? 0.5 : 1,
                    backgroundColor: pressed ? c.surface : "transparent",
                    borderBottomWidth: 1,
                    borderBottomColor: c.line,
                  })}
                >
                  <Avatar src={ch.avatar_url} name={ch.name} size={36} />
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <T weight="semibold" numberOfLines={1}>
                      {ch.name}
                    </T>
                    {ch.tagline ? (
                      <T size="xs" tone="ink3" numberOfLines={1}>
                        {ch.tagline}
                      </T>
                    ) : null}
                  </View>
                  <View
                    style={{
                      width: 24,
                      height: 24,
                      borderRadius: 12,
                      borderWidth: 1,
                      borderColor: on ? c.ember : c.line,
                      backgroundColor: on ? c.ember : "transparent",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    {on && <Check size={14} color={c.emberInk} />}
                  </View>
                </Pressable>
              );
            })}
            {pool.length === 0 && (
              <T size="sm" tone="ink3" style={{ padding: 16, textAlign: "center" }}>
                {search.isLoading ? "Loading…" : "No characters match."}
              </T>
            )}
          </View>
        </View>

        <Button
          label={editing ? "Save room" : "Create room"}
          onPress={save}
          loading={busy}
          disabled={!valid}
        />
        {editing && (
          <Button label="Delete room" variant="ghost" onPress={() => setConfirmDelete(true)} />
        )}
      </ScrollView>

      <Sheet open={confirmDelete} onClose={() => setConfirmDelete(false)} title="Delete this room?">
        <View style={{ gap: 12, paddingBottom: 8 }}>
          <T tone="ink2">The room and its whole conversation are deleted. The characters stay.</T>
          <Button
            label="Delete room"
            variant="danger"
            onPress={async () => {
              try {
                await api.deleteRoom(id);
                void qc.invalidateQueries({ queryKey: ["chats"] });
                setConfirmDelete(false);
                router.replace("/chats");
              } catch (e) {
                toast(errorText(e), "error");
              }
            }}
          />
        </View>
      </Sheet>
    </KeyboardAvoidingView>
  );
}
