import type { Character, CharacterInput, Visibility } from "@persona/shared";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import * as DocumentPicker from "expo-document-picker";
import { router } from "expo-router";
import {
  ArrowLeft,
  ChevronDown,
  ChevronUp,
  FileUp,
  ImagePlus,
  Sparkles,
  Trash2,
} from "lucide-react-native";
import { useState } from "react";
import { KeyboardAvoidingView, Pressable, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { api, errorText } from "../lib/api";
import { pickImage } from "../lib/images";
import { radius, useTheme } from "../lib/theme";
import { useCaps } from "../lib/voice";
import { AvatarGenerator } from "./AvatarGenerator";
import { Avatar, Button, Chip, Field, IconButton, Loading, Sheet, T, useToast } from "./ui";
import { VoicePicker } from "./VoicePicker";

type Form = Required<Omit<CharacterInput, "llm_params">> & { llm_params: Record<string, number> };
const EMPTY: Form = {
  name: "",
  tagline: "",
  description: "",
  greeting: "",
  definition: "",
  personality: "",
  scenario: "",
  avatar_url: null,
  voice_id: null,
  visibility: "public",
  tags: [],
  creator_credit: "",
  llm_model: null,
  llm_params: {},
};

const VIS: { id: Visibility; label: string; hint: string }[] = [
  { id: "public", label: "Public", hint: "Anyone on this server can find and chat." },
  { id: "unlisted", label: "Unlisted", hint: "Only people with the link." },
  { id: "private", label: "Private", hint: "Only you." },
];

function toForm(ch: Character): Form {
  return {
    name: ch.name,
    tagline: ch.tagline,
    description: ch.description,
    greeting: ch.greeting,
    definition: ch.definition ?? "",
    personality: ch.personality ?? "",
    scenario: ch.scenario ?? "",
    avatar_url: ch.avatar_url,
    voice_id: ch.voice_id,
    visibility: ch.visibility,
    tags: ch.tags,
    creator_credit: ch.creator_credit,
    llm_model: ch.llm_model,
    llm_params: (ch.llm_params ?? {}) as Record<string, number>,
  };
}

/** Loads the character (when editing), then mounts the form seeded with it. */
export function CharacterEditor({ id, tab }: { id?: string; tab?: boolean }) {
  const insets = useSafeAreaInsets();
  const existing = useQuery({
    queryKey: ["character", id],
    queryFn: () => api.character(id!),
    enabled: !!id,
  });
  if (id && existing.isLoading) return <Loading />;
  if (id && existing.data && !existing.data.is_owner && existing.data.definition === null)
    return (
      <View style={{ flex: 1, padding: 24, paddingTop: insets.top + 24 }}>
        <T tone="ink2">You can only edit characters you created.</T>
      </View>
    );
  return <EditorForm key={id ?? "new"} id={id} tab={tab} initial={existing.data} />;
}

function EditorForm({ id, tab, initial }: { id?: string; tab?: boolean; initial?: Character }) {
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const qc = useQueryClient();
  const caps = useCaps();
  const editing = !!id;
  const models = useQuery({
    queryKey: ["models"],
    queryFn: () => api.models(),
    staleTime: 300_000,
  });
  const [form, setForm] = useState<Form>(() => (initial ? toForm(initial) : EMPTY));
  const [tagDraft, setTagDraft] = useState("");
  const [advanced, setAdvanced] = useState(false);
  const [busy, setBusy] = useState(false);
  const [gen, setGen] = useState(false);
  const [voiceOpen, setVoiceOpen] = useState(false);
  const [voiceName, setVoiceName] = useState<string | null>(initial?.voice?.name ?? null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }));

  const addTag = () => {
    const t = tagDraft.trim().toLowerCase().replace(/^#/, "").slice(0, 32);
    if (t && !form.tags.includes(t) && form.tags.length < 20) set("tags", [...form.tags, t]);
    setTagDraft("");
  };

  const save = async () => {
    setBusy(true);
    try {
      const body = { ...form, name: form.name.trim() };
      const ch = editing ? await api.updateCharacter(id!, body) : await api.createCharacter(body);
      void qc.invalidateQueries({ queryKey: ["discover"] });
      qc.setQueryData(["character", ch.id], ch);
      if (editing) {
        toast("Saved", "success");
        router.back();
      } else {
        const chat = await api.createChat({ character_id: ch.id });
        void qc.invalidateQueries({ queryKey: ["chats"] });
        setForm(EMPTY);
        router.push(`/chat/${chat.id}`);
      }
    } catch (e) {
      toast(errorText(e), "error");
    } finally {
      setBusy(false);
    }
  };

  const importCard = async () => {
    const r = await DocumentPicker.getDocumentAsync({
      type: ["application/json", "image/png"],
      copyToCacheDirectory: true,
    });
    if (r.canceled) return;
    const f = r.assets[0];
    try {
      const ch = await api.importCard({
        uri: f.uri,
        name: f.name,
        type: f.mimeType ?? (f.name.endsWith(".png") ? "image/png" : "application/json"),
      });
      toast(`Imported ${ch.name} as private. Review it, then publish.`, "success");
      router.push(`/edit/${ch.id}`);
    } catch (e) {
      toast(errorText(e), "error");
    }
  };

  const temp = form.llm_params.temperature;

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
        {!tab && (
          <IconButton label="Back" onPress={() => router.back()}>
            <ArrowLeft size={22} color={c.ink} />
          </IconButton>
        )}
        <T size="xl" weight="extrabold" style={{ flex: 1, paddingHorizontal: 8 }} numberOfLines={1}>
          {editing ? `Edit ${initial?.name ?? ""}` : "Create a character"}
        </T>
        {!editing && (
          <Button
            label="Import"
            small
            variant="ghost"
            icon={<FileUp size={16} color={c.ink} />}
            onPress={importCard}
          />
        )}
      </View>
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ padding: 16, gap: 18, paddingBottom: insets.bottom + 40 }}
      >
        <View style={{ flexDirection: "row", alignItems: "center", gap: 16 }}>
          <Avatar src={form.avatar_url} name={form.name || "?"} size={88} />
          <View style={{ gap: 8, flex: 1 }}>
            <Button
              label="Upload picture"
              small
              variant="secondary"
              icon={<ImagePlus size={16} color={c.ink} />}
              onPress={async () => {
                try {
                  const url = await pickImage();
                  if (url) set("avatar_url", url);
                } catch (e) {
                  toast(errorText(e), "error");
                }
              }}
            />
            {caps.data?.image && (
              <Button
                label="Generate"
                small
                variant="secondary"
                icon={<Sparkles size={16} color={c.ink} />}
                onPress={() => setGen(true)}
              />
            )}
          </View>
        </View>

        <Field label="Name" value={form.name} maxLength={64} onChangeText={(v) => set("name", v)} />
        <Field
          label="Tagline"
          value={form.tagline}
          maxLength={140}
          placeholder="One line people see on Discover"
          onChangeText={(v) => set("tagline", v)}
        />
        <Field
          label="Description"
          value={form.description}
          multiline
          placeholder="Who they are, how they talk, what they want."
          onChangeText={(v) => set("description", v)}
        />
        <Field
          label="Greeting"
          value={form.greeting}
          multiline
          placeholder="Their first message. {{user}} becomes the reader's name."
          onChangeText={(v) => set("greeting", v)}
        />

        <View style={{ gap: 8 }}>
          <T size="sm" weight="semibold" tone="ink2">
            Tags
          </T>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
            {form.tags.map((t) => (
              <Chip
                key={t}
                label={`#${t}  ✕`}
                onPress={() =>
                  set(
                    "tags",
                    form.tags.filter((x) => x !== t),
                  )
                }
              />
            ))}
          </View>
          <Field
            value={tagDraft}
            onChangeText={setTagDraft}
            placeholder="Add a tag and press enter"
            autoCapitalize="none"
            returnKeyType="done"
            submitBehavior="submit"
            onSubmitEditing={addTag}
          />
        </View>

        <View style={{ gap: 8 }}>
          <T size="sm" weight="semibold" tone="ink2">
            Who can chat
          </T>
          {VIS.map((v) => (
            <Pressable
              key={v.id}
              accessibilityRole="radio"
              accessibilityState={{ checked: form.visibility === v.id }}
              onPress={() => set("visibility", v.id)}
              style={{
                padding: 12,
                borderRadius: radius.control,
                borderWidth: 1,
                borderColor: form.visibility === v.id ? c.ember : c.line,
                backgroundColor: form.visibility === v.id ? c.emberSoft : "transparent",
              }}
            >
              <T weight="semibold">{v.label}</T>
              <T size="xs" tone="ink2">
                {v.hint}
              </T>
            </Pressable>
          ))}
        </View>

        {caps.data?.tts && (
          <Pressable
            accessibilityRole="button"
            onPress={() => setVoiceOpen(true)}
            style={{
              padding: 14,
              borderRadius: radius.control,
              backgroundColor: c.surface,
              flexDirection: "row",
              alignItems: "center",
            }}
          >
            <View style={{ flex: 1 }}>
              <T size="sm" weight="semibold" tone="ink2">
                Voice
              </T>
              <T>{voiceName ?? "Server default"}</T>
            </View>
            <ChevronDown size={18} color={c.ink3} />
          </Pressable>
        )}

        <Pressable
          accessibilityRole="button"
          accessibilityState={{ expanded: advanced }}
          onPress={() => setAdvanced((a) => !a)}
          style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 6 }}
        >
          <T weight="semibold">Advanced</T>
          {advanced ? (
            <ChevronUp size={18} color={c.ink2} />
          ) : (
            <ChevronDown size={18} color={c.ink2} />
          )}
        </Pressable>
        {advanced && (
          <View style={{ gap: 16 }}>
            <Field
              label="Example dialog"
              value={form.definition}
              multiline
              style={{ minHeight: 140 }}
              placeholder={"{{user}}: Hi!\n{{char}}: *looks up* Oh, hello."}
              hint="Shows the model how this character writes. Separate examples with <START>. Only you can see this."
              onChangeText={(v) => set("definition", v)}
            />
            <Field
              label="Personality"
              value={form.personality}
              multiline
              onChangeText={(v) => set("personality", v)}
            />
            <Field
              label="Scenario"
              value={form.scenario}
              multiline
              onChangeText={(v) => set("scenario", v)}
            />
            {(models.data?.length ?? 0) > 1 && (
              <View style={{ gap: 8 }}>
                <T size="sm" weight="semibold" tone="ink2">
                  Model
                </T>
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
                  <Chip
                    label="Server default"
                    active={!form.llm_model}
                    onPress={() => set("llm_model", null)}
                  />
                  {models.data!.map((m) => (
                    <Chip
                      key={m.id}
                      label={m.label || m.id}
                      active={form.llm_model === m.id}
                      onPress={() => set("llm_model", m.id)}
                    />
                  ))}
                </View>
              </View>
            )}
            <View style={{ gap: 8 }}>
              <T size="sm" weight="semibold" tone="ink2">
                Creativity: {temp ?? "default"}
              </T>
              <View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap" }}>
                {[undefined, 0.5, 0.7, 0.9, 1.1].map((t) => (
                  <Chip
                    key={String(t)}
                    label={
                      t === undefined
                        ? "Default"
                        : t < 0.7
                          ? `${t} focused`
                          : t > 0.95
                            ? `${t} wild`
                            : String(t)
                    }
                    active={temp === t}
                    onPress={() => {
                      const { temperature: _drop, ...rest } = form.llm_params;
                      set("llm_params", t === undefined ? rest : { ...rest, temperature: t });
                    }}
                  />
                ))}
              </View>
            </View>
          </View>
        )}

        <Button
          label={editing ? "Save changes" : "Create character"}
          onPress={save}
          loading={busy}
          disabled={!form.name.trim()}
        />
        {editing && (
          <Button
            label="Delete character"
            variant="ghost"
            icon={<Trash2 size={16} color={c.err} />}
            onPress={() => setConfirmDelete(true)}
          />
        )}
      </ScrollView>

      <AvatarGenerator
        open={gen}
        onClose={() => setGen(false)}
        characterId={id}
        form={form}
        onDone={(url) => {
          set("avatar_url", url);
          setGen(false);
        }}
      />
      <VoicePicker
        open={voiceOpen}
        onClose={() => setVoiceOpen(false)}
        value={form.voice_id}
        onChange={(vid, v) => {
          set("voice_id", vid);
          setVoiceName(v?.name ?? null);
        }}
      />
      <Sheet
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title={`Delete ${form.name}?`}
      >
        <View style={{ gap: 12, paddingBottom: 8 }}>
          <T tone="ink2">
            Everyone&apos;s chats with this character are deleted too. This can&apos;t be undone.
          </T>
          <Button
            label="Delete character"
            variant="danger"
            onPress={async () => {
              try {
                await api.deleteCharacter(id!);
                void qc.invalidateQueries();
                setConfirmDelete(false);
                router.replace("/");
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
