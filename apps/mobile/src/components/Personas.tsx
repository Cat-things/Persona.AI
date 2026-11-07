import type { Persona } from "@persona/shared";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Plus } from "lucide-react-native";
import { useState } from "react";
import { Pressable, Switch, View } from "react-native";
import { api, errorText } from "../lib/api";
import { useAuth } from "../lib/auth";
import { pickImage } from "../lib/images";
import { radius, useTheme } from "../lib/theme";
import { Avatar, Button, Field, Sheet, T, useToast } from "./ui";

export function usePersonas() {
  return useQuery({ queryKey: ["personas"], queryFn: () => api.personas() });
}

type Draft = Omit<Persona, "id">;
const EMPTY: Draft = { name: "", description: "", avatar_url: null, is_default: false };

export function PersonaForm({
  initial,
  onSaved,
  onCancel,
}: {
  initial?: Persona;
  onSaved: (p: Persona) => void;
  onCancel: () => void;
}) {
  const { c } = useTheme();
  const toast = useToast();
  const qc = useQueryClient();
  const { setUser } = useAuth();
  const [d, setD] = useState<Draft>(initial ?? EMPTY);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    try {
      const p = initial
        ? await api.updatePersona(initial.id, d)
        : await api.createPersona({ ...d, name: d.name.trim() });
      await qc.invalidateQueries({ queryKey: ["personas"] });
      setUser(await api.me());
      onSaved(p);
    } catch (e) {
      toast(errorText(e), "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={{ gap: 14, paddingBottom: 8 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 14 }}>
        <Avatar src={d.avatar_url} name={d.name || "?"} size={56} />
        <Button
          label="Picture"
          variant="secondary"
          small
          onPress={async () => {
            try {
              const url = await pickImage();
              if (url) setD((x) => ({ ...x, avatar_url: url }));
            } catch (e) {
              toast(errorText(e), "error");
            }
          }}
        />
      </View>
      <Field
        label="Name"
        value={d.name}
        maxLength={64}
        onChangeText={(name) => setD({ ...d, name })}
      />
      <Field
        label="About you"
        value={d.description}
        maxLength={4000}
        multiline
        placeholder="What characters should know: appearance, background, how you talk."
        hint="Characters see this in every chat where you use this persona."
        onChangeText={(description) => setD({ ...d, description })}
      />
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
        <T>Use for new chats</T>
        <Switch
          value={d.is_default}
          onValueChange={(is_default) => setD({ ...d, is_default })}
          trackColor={{ true: c.ember, false: c.surface2 }}
          accessibilityLabel="Use for new chats"
        />
      </View>
      <View style={{ flexDirection: "row", gap: 10 }}>
        <Button label="Cancel" variant="ghost" onPress={onCancel} style={{ flex: 1 }} />
        <Button
          label={initial ? "Save persona" : "Create persona"}
          onPress={save}
          loading={busy}
          disabled={!d.name.trim()}
          style={{ flex: 2 }}
        />
      </View>
    </View>
  );
}

/** Chat-level picker: who you are in this chat. */
export function PersonaPicker({
  open,
  onClose,
  current,
  onPick,
}: {
  open: boolean;
  onClose: () => void;
  current: string | null;
  onPick: (id: string | null) => Promise<void>;
}) {
  const { c } = useTheme();
  const { data = [] } = usePersonas();
  const { user } = useAuth();
  const [creating, setCreating] = useState(false);
  const options = [
    {
      id: null as string | null,
      name: user?.display_name || user?.username || "Me",
      avatar: user?.avatar_url ?? null,
      sub: "Your profile",
    },
    ...data.map((p) => ({
      id: p.id as string | null,
      name: p.name,
      avatar: p.avatar_url,
      sub: p.description,
    })),
  ];
  return (
    <Sheet
      open={open}
      onClose={() => (setCreating(false), onClose())}
      title={creating ? "New persona" : "Talk as"}
    >
      {creating ? (
        <PersonaForm
          onCancel={() => setCreating(false)}
          onSaved={async (p) => {
            setCreating(false);
            await onPick(p.id);
          }}
        />
      ) : (
        <View style={{ gap: 2, paddingBottom: 8 }}>
          {options.map((o) => (
            <Pressable
              key={o.id ?? "me"}
              accessibilityRole="button"
              accessibilityState={{ selected: o.id === current }}
              onPress={() => void onPick(o.id)}
              style={({ pressed }) => ({
                flexDirection: "row",
                alignItems: "center",
                gap: 12,
                padding: 8,
                borderRadius: radius.control,
                backgroundColor: o.id === current || pressed ? c.surface2 : "transparent",
              })}
            >
              <Avatar src={o.avatar} name={o.name} size={42} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <T weight="semibold" numberOfLines={1}>
                  {o.name}
                </T>
                {o.sub ? (
                  <T size="xs" tone="ink3" numberOfLines={1}>
                    {o.sub}
                  </T>
                ) : null}
              </View>
              {o.id === current && <Check size={20} color={c.ember} />}
            </Pressable>
          ))}
          <Button
            label="New persona"
            variant="ghost"
            icon={<Plus size={18} color={c.ink} />}
            onPress={() => setCreating(true)}
            style={{ alignSelf: "flex-start" }}
          />
        </View>
      )}
    </Sheet>
  );
}
