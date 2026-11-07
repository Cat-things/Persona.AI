import type { Persona } from "@persona/shared";
import { useQueryClient } from "@tanstack/react-query";
import * as Linking from "expo-linking";
import { LogOut, Pencil, Plus, Server, Shield, Trash2 } from "lucide-react-native";
import { useState, type ReactNode } from "react";
import { ScrollView, Switch, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { PersonaForm, usePersonas } from "../../../components/Personas";
import {
  Avatar,
  Button,
  Card,
  Chip,
  Field,
  IconButton,
  Sheet,
  T,
  useToast,
} from "../../../components/ui";
import { api, errorText } from "../../../lib/api";
import { useAuth, useUser } from "../../../lib/auth";
import { pickImage } from "../../../lib/images";
import { useStore } from "../../../lib/store";
import { themePref, useTheme, type ThemePref } from "../../../lib/theme";
import { useCaps } from "../../../lib/voice";

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <Card style={{ gap: 14 }}>
      <View style={{ gap: 2 }}>
        <T weight="bold" size="lg">
          {title}
        </T>
        {description ? (
          <T size="sm" tone="ink2">
            {description}
          </T>
        ) : null}
      </View>
      {children}
    </Card>
  );
}

function ToggleRow({
  label,
  value,
  onChange,
  hint,
}: {
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
  hint?: string;
}) {
  const { c } = useTheme();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
      <View style={{ flex: 1, gap: 2 }}>
        <T>{label}</T>
        {hint ? (
          <T size="xs" tone="ink3">
            {hint}
          </T>
        ) : null}
      </View>
      <Switch
        value={value}
        onValueChange={onChange}
        trackColor={{ true: c.ember, false: c.surface2 }}
        accessibilityLabel={label}
      />
    </View>
  );
}

export default function Me() {
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const qc = useQueryClient();
  const user = useUser();
  const { setUser, logout, changeServer, server, config } = useAuth();
  const caps = useCaps();
  const personas = usePersonas();
  const [displayName, setDisplayName] = useState(user.display_name);
  const [bio, setBio] = useState(user.bio);
  const [editing, setEditing] = useState<Persona | "new" | null>(null);
  const theme = useStore(themePref);

  const update = async (body: Parameters<typeof api.updateMe>[0], msg?: string) => {
    try {
      setUser(await api.updateMe(body));
      if (msg) toast(msg, "success");
    } catch (e) {
      toast(errorText(e), "error");
    }
  };

  return (
    <ScrollView
      contentContainerStyle={{
        padding: 16,
        paddingTop: insets.top + 12,
        gap: 16,
        paddingBottom: 40,
      }}
      keyboardShouldPersistTaps="handled"
    >
      <T size="2xl" weight="extrabold">
        You
      </T>

      <Section title="Profile">
        <View style={{ flexDirection: "row", alignItems: "center", gap: 14 }}>
          <Avatar src={user.avatar_url} name={user.display_name || user.username} size={64} />
          <View style={{ flex: 1 }}>
            <T weight="bold">@{user.username}</T>
            <Button
              label="Change photo"
              small
              variant="secondary"
              style={{ alignSelf: "flex-start", marginTop: 6 }}
              onPress={async () => {
                try {
                  const url = await pickImage();
                  if (url) await update({ avatar_url: url }, "Photo updated");
                } catch (e) {
                  toast(errorText(e), "error");
                }
              }}
            />
          </View>
        </View>
        <Field
          label="Display name"
          value={displayName}
          maxLength={64}
          onChangeText={setDisplayName}
          hint="Characters call you this unless you pick a persona."
        />
        <Field label="Bio" value={bio} maxLength={2000} multiline onChangeText={setBio} />
        <Button
          label="Save profile"
          onPress={() => update({ display_name: displayName, bio }, "Saved")}
        />
      </Section>

      <Section
        title="Personas"
        description="Who you are in a chat. Pick one per chat, or set a default."
      >
        {(personas.data ?? []).map((p) => (
          <View key={p.id} style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
            <Avatar src={p.avatar_url} name={p.name} size={40} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <T weight="semibold" numberOfLines={1}>
                {p.name}
                {p.is_default ? (
                  <T size="xs" tone="ember">
                    {"  "}Default
                  </T>
                ) : null}
              </T>
              {p.description ? (
                <T size="xs" tone="ink3" numberOfLines={1}>
                  {p.description}
                </T>
              ) : null}
            </View>
            <IconButton label={`Edit ${p.name}`} onPress={() => setEditing(p)} size={38}>
              <Pencil size={17} color={c.ink2} />
            </IconButton>
            <IconButton
              label={`Delete ${p.name}`}
              size={38}
              onPress={async () => {
                try {
                  await api.deletePersona(p.id);
                  await qc.invalidateQueries({ queryKey: ["personas"] });
                  setUser(await api.me());
                } catch (e) {
                  toast(errorText(e), "error");
                }
              }}
            >
              <Trash2 size={17} color={c.ink3} />
            </IconButton>
          </View>
        ))}
        <Button
          label="New persona"
          variant="secondary"
          small
          icon={<Plus size={16} color={c.ink} />}
          onPress={() => setEditing("new")}
          style={{ alignSelf: "flex-start" }}
        />
      </Section>

      <Section title="Appearance">
        <View style={{ flexDirection: "row", gap: 8 }}>
          {(["dark", "light", "system"] as ThemePref[]).map((t) => (
            <Chip
              key={t}
              label={t === "system" ? "Match phone" : t === "dark" ? "Dark" : "Light"}
              active={theme === t}
              onPress={() => {
                themePref.set(t);
                void update({ preferences: { theme: t } });
              }}
            />
          ))}
        </View>
      </Section>

      {caps.data?.tts && (
        <Section title="Voice">
          <ToggleRow
            label="Auto-play new replies"
            value={!!user.preferences.autoplay_voice}
            onChange={(v) => update({ preferences: { autoplay_voice: v } })}
          />
        </Section>
      )}

      <Section
        title="Help train this instance's model"
        description="Off by default. Only the server's admin can export the data."
      >
        <ToggleRow
          label="Use my rated chats for training"
          value={user.preferences.training_opt_in === true}
          onChange={(v) => update({ preferences: { training_opt_in: v } })}
          hint="Replies you rate 3 or 4 stars are learned from. Names, emails, phone numbers and links are removed, and anything the content filter flags is left out."
        />
      </Section>

      <Section title="Server">
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
          <Server size={18} color={c.ink2} />
          <View style={{ flex: 1 }}>
            <T weight="semibold">{config?.instance_name || "Persona.AI"}</T>
            <T size="xs" tone="ink3" numberOfLines={1}>
              {server} {config?.version ? `· v${config.version}` : ""}
            </T>
          </View>
        </View>
        {user.is_admin && server && (
          <Button
            label="Open admin panel in browser"
            variant="secondary"
            small
            icon={<Shield size={16} color={c.ink} />}
            onPress={() => void Linking.openURL(`${server}/admin`)}
          />
        )}
        <View style={{ flexDirection: "row", gap: 10 }}>
          <Button
            label="Change server"
            variant="secondary"
            style={{ flex: 1 }}
            onPress={changeServer}
          />
          <Button
            label="Sign out"
            variant="ghost"
            icon={<LogOut size={16} color={c.err} />}
            style={{ flex: 1 }}
            onPress={() => {
              qc.clear();
              void logout();
            }}
          />
        </View>
      </Section>

      <Sheet
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={editing === "new" ? "New persona" : "Edit persona"}
      >
        {editing !== null && (
          <PersonaForm
            initial={editing === "new" ? undefined : editing}
            onSaved={() => setEditing(null)}
            onCancel={() => setEditing(null)}
          />
        )}
      </Sheet>
    </ScrollView>
  );
}
