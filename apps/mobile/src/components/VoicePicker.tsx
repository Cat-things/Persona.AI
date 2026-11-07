import type { Voice } from "@persona/shared";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import * as DocumentPicker from "expo-document-picker";
import { Check, Loader2, Play, Square } from "lucide-react-native";
import { useMemo, useState } from "react";
import { Pressable, Switch, View } from "react-native";
import { api, errorText } from "../lib/api";
import { radius, useTheme } from "../lib/theme";
import { useCaps, useVoicePlayer, voicePlayer } from "../lib/voice";
import { Button, Field, Sheet, T, useToast } from "./ui";

function VoiceRow({
  v,
  selected,
  onSelect,
}: {
  v: Voice;
  selected: boolean;
  onSelect: () => void;
}) {
  const { c } = useTheme();
  const st = useVoicePlayer();
  const toast = useToast();
  const key = `v:${v.id}`;
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        borderRadius: radius.control,
        backgroundColor: selected ? c.emberSoft : "transparent",
      }}
    >
      <Pressable
        accessibilityLabel={st.playing === key ? `Stop ${v.name}` : `Preview ${v.name}`}
        onPress={() => void voicePlayer.preview(v.id).catch((e) => toast(errorText(e), "error"))}
        style={{ padding: 12 }}
        hitSlop={4}
      >
        {st.loading === key ? (
          <Loader2 size={18} color={c.ink2} />
        ) : st.playing === key ? (
          <Square size={14} color={c.ember} fill={c.ember} />
        ) : (
          <Play size={18} color={c.ink2} />
        )}
      </Pressable>
      <Pressable
        accessibilityRole="radio"
        accessibilityState={{ checked: selected }}
        onPress={onSelect}
        style={{ flex: 1, paddingVertical: 10, flexDirection: "row", alignItems: "center", gap: 8 }}
      >
        <View style={{ flex: 1, minWidth: 0 }}>
          <T weight="semibold" numberOfLines={1}>
            {v.name}
          </T>
          <T size="xs" tone="ink3" numberOfLines={1}>
            {[v.language, v.gender, v.provider, v.owner_id ? "cloned" : ""]
              .filter(Boolean)
              .join(" · ")}
          </T>
        </View>
        {selected && <Check size={18} color={c.ember} style={{ marginRight: 10 }} />}
      </Pressable>
    </View>
  );
}

function CloneForm({ onCreated }: { onCreated: (v: Voice) => void }) {
  const { c } = useTheme();
  const toast = useToast();
  const [file, setFile] = useState<DocumentPicker.DocumentPickerAsset | null>(null);
  const [name, setName] = useState("");
  const [rights, setRights] = useState(false);
  const [busy, setBusy] = useState(false);
  return (
    <View style={{ gap: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: c.line }}>
      <T weight="bold">Clone a voice</T>
      <T size="sm" tone="ink2">
        Upload 10 to 30 seconds of clear speech (wav, mp3, m4a, ogg).
      </T>
      <Button
        label={file ? file.name : "Choose audio file"}
        variant="secondary"
        small
        onPress={async () => {
          const r = await DocumentPicker.getDocumentAsync({
            type: "audio/*",
            copyToCacheDirectory: true,
          });
          if (!r.canceled) setFile(r.assets[0]);
        }}
      />
      <Field label="Voice name" value={name} onChangeText={setName} maxLength={64} />
      <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
        <Switch
          value={rights}
          onValueChange={setRights}
          trackColor={{ true: c.ember, false: c.surface2 }}
          accessibilityLabel="I have the rights to this voice"
        />
        <T size="sm" style={{ flex: 1 }}>
          This is my voice, or I have the speaker&apos;s permission to clone it.
        </T>
      </View>
      <Button
        label="Clone voice"
        loading={busy}
        disabled={!file || !name.trim() || !rights}
        onPress={async () => {
          if (!file) return;
          setBusy(true);
          try {
            const v = await api.cloneVoice(
              { uri: file.uri, name: file.name, type: file.mimeType ?? "audio/mpeg" },
              name.trim(),
              rights,
            );
            toast("Voice cloned", "success");
            onCreated(v);
          } catch (e) {
            toast(errorText(e), "error");
          } finally {
            setBusy(false);
          }
        }}
      />
    </View>
  );
}

export function VoicePicker({
  open,
  onClose,
  value,
  onChange,
}: {
  open: boolean;
  onClose: () => void;
  value: string | null;
  onChange: (id: string | null, v: Voice | null) => void;
}) {
  const caps = useCaps();
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const voices = useQuery({ queryKey: ["voices"], queryFn: () => api.voices(), enabled: open });
  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    return (voices.data ?? []).filter(
      (v) => !s || `${v.name} ${v.language} ${v.gender} ${v.description}`.toLowerCase().includes(s),
    );
  }, [voices.data, q]);

  return (
    <Sheet
      open={open}
      onClose={() => {
        voicePlayer.stop();
        onClose();
      }}
      title="Voice"
    >
      <View style={{ gap: 10, paddingBottom: 8 }}>
        <Field
          value={q}
          onChangeText={setQ}
          placeholder="Search voices or languages"
          autoCorrect={false}
        />
        <Pressable
          accessibilityRole="radio"
          accessibilityState={{ checked: !value }}
          onPress={() => onChange(null, null)}
          style={{ padding: 10 }}
        >
          <T weight="semibold" tone={value ? "ink2" : "ember"}>
            Server default
          </T>
        </Pressable>
        {voices.isLoading ? (
          <T tone="ink3">Loading voices…</T>
        ) : (
          list
            .slice(0, 120)
            .map((v) => (
              <VoiceRow
                key={v.id}
                v={v}
                selected={value === v.id}
                onSelect={() => onChange(v.id, v)}
              />
            ))
        )}
        {caps.data?.voice_cloning && (
          <CloneForm
            onCreated={(v) => {
              void qc.invalidateQueries({ queryKey: ["voices"] });
              onChange(v.id, v);
            }}
          />
        )}
      </View>
    </Sheet>
  );
}
