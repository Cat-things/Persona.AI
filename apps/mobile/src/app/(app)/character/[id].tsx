import { compactNumber } from "@persona/shared";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { router, useLocalSearchParams } from "expo-router";
import { ArrowLeft, Flag, Heart, MessageCircle, Pencil, Plus } from "lucide-react-native";
import { useState } from "react";
import { ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  Avatar,
  Button,
  EmptyState,
  Field,
  IconButton,
  Loading,
  Sheet,
  T,
  useToast,
} from "../../../components/ui";
import { api, errorText } from "../../../lib/api";
import { chatWith } from "../../../lib/nav";
import { useTheme } from "../../../lib/theme";

export default function CharacterScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["character", id], queryFn: () => api.character(id) });
  const threads = useQuery({ queryKey: ["threads", id], queryFn: () => api.characterChats(id) });
  const [starting, setStarting] = useState<"continue" | "new" | null>(null);
  const [reporting, setReporting] = useState(false);
  const [reason, setReason] = useState("");

  if (q.isLoading) return <Loading />;
  if (q.isError || !q.data)
    return (
      <EmptyState
        title="Character not found"
        body={q.error ? errorText(q.error) : undefined}
        action={<Button label="Go back" variant="secondary" onPress={() => router.back()} />}
      />
    );
  const ch = q.data;
  const creator = ch.creator?.username ?? ch.creator_credit;
  const hasChats = (threads.data?.length ?? 0) > 0;

  const start = async (fresh: boolean) => {
    setStarting(fresh ? "new" : "continue");
    try {
      await chatWith(ch.id, fresh);
      void qc.invalidateQueries({ queryKey: ["chats"] });
    } catch (e) {
      toast(errorText(e), "error");
    } finally {
      setStarting(null);
    }
  };

  const toggleLike = async () => {
    try {
      const updated = ch.liked ? await api.unlike(ch.id) : await api.like(ch.id);
      qc.setQueryData(["character", id], updated);
    } catch (e) {
      toast(errorText(e), "error");
    }
  };

  return (
    <View style={{ flex: 1 }}>
      <View style={{ paddingTop: insets.top, paddingHorizontal: 8, flexDirection: "row" }}>
        <IconButton label="Back" onPress={() => router.back()}>
          <ArrowLeft size={22} color={c.ink} />
        </IconButton>
        <View style={{ flex: 1 }} />
        {ch.is_owner ? (
          <IconButton label={`Edit ${ch.name}`} onPress={() => router.push(`/edit/${ch.id}`)}>
            <Pencil size={20} color={c.ink} />
          </IconButton>
        ) : (
          <IconButton label={`Report ${ch.name}`} onPress={() => setReporting(true)}>
            <Flag size={20} color={c.ink2} />
          </IconButton>
        )}
      </View>
      <ScrollView
        contentContainerStyle={{ padding: 20, paddingBottom: insets.bottom + 120, gap: 18 }}
      >
        <View style={{ alignItems: "center", gap: 8 }}>
          <Avatar src={ch.avatar_url} name={ch.name} size={120} />
          <T size="2xl" weight="extrabold" style={{ textAlign: "center" }}>
            {ch.name}
          </T>
          {creator ? (
            <T size="sm" tone="ink3">
              By @{creator}
            </T>
          ) : null}
          {ch.tagline ? (
            <T tone="ink2" style={{ textAlign: "center" }}>
              {ch.tagline}
            </T>
          ) : null}
          <View style={{ flexDirection: "row", gap: 16, marginTop: 4 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
              <MessageCircle size={14} color={c.ink3} />
              <T size="sm" tone="ink3">
                {compactNumber(ch.interaction_count)} chats
              </T>
            </View>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
              <Heart size={14} color={c.ink3} />
              <T size="sm" tone="ink3">
                {compactNumber(ch.like_count)}
              </T>
            </View>
          </View>
        </View>

        {ch.description ? (
          <View style={{ gap: 6 }}>
            <T weight="bold">About</T>
            <T tone="ink2">{ch.description}</T>
          </View>
        ) : null}

        {ch.tags.length > 0 && (
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
            {ch.tags.map((t) => (
              <View
                key={t}
                style={{
                  backgroundColor: c.surface,
                  borderRadius: 999,
                  paddingHorizontal: 10,
                  paddingVertical: 4,
                }}
              >
                <T size="xs" tone="ink2">
                  #{t}
                </T>
              </View>
            ))}
          </View>
        )}

        {hasChats && (
          <View style={{ gap: 6 }}>
            <T weight="bold">Your chats</T>
            {threads.data!.slice(0, 5).map((t) => (
              <Button
                key={t.id}
                small
                variant="ghost"
                label={t.last_message ? t.last_message.slice(0, 60) : t.title}
                onPress={() => router.push(`/chat/${t.id}`)}
                style={{ justifyContent: "flex-start", paddingHorizontal: 0 }}
              />
            ))}
          </View>
        )}
      </ScrollView>

      <View
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: 0,
          flexDirection: "row",
          gap: 10,
          padding: 16,
          paddingBottom: insets.bottom + 12,
          backgroundColor: c.bg,
          borderTopWidth: 1,
          borderTopColor: c.line,
        }}
      >
        <IconButton
          label={ch.liked ? "Unlike" : "Like"}
          onPress={toggleLike}
          size={48}
          active={ch.liked}
        >
          <Heart size={22} color={ch.liked ? c.ember : c.ink} fill={ch.liked ? c.ember : "none"} />
        </IconButton>
        {hasChats && (
          <Button
            label="New chat"
            variant="secondary"
            icon={<Plus size={18} color={c.ink} />}
            loading={starting === "new"}
            onPress={() => start(true)}
          />
        )}
        <Button
          label={hasChats ? "Continue" : "Start chatting"}
          loading={starting === "continue"}
          onPress={() => start(false)}
          style={{ flex: 1 }}
        />
      </View>

      <Sheet open={reporting} onClose={() => setReporting(false)} title={`Report ${ch.name}`}>
        <View style={{ gap: 12, paddingBottom: 8 }}>
          <Field
            label="What's wrong?"
            value={reason}
            onChangeText={setReason}
            multiline
            placeholder="Tell the admins what this character does that breaks the rules."
          />
          <Button
            label="Send report"
            disabled={reason.trim().length < 3}
            onPress={async () => {
              try {
                await api.report("character", ch.id, reason.trim());
                setReporting(false);
                setReason("");
                toast("Thanks, the admins will take a look.", "success");
              } catch (e) {
                toast(errorText(e), "error");
              }
            }}
          />
        </View>
      </Sheet>
    </View>
  );
}
