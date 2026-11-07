import { useQuery } from "@tanstack/react-query";
import { Image } from "expo-image";
import { Sparkles } from "lucide-react-native";
import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, View } from "react-native";
import { api, errorText, media } from "../lib/api";
import { radius, useTheme } from "../lib/theme";
import { Button, Chip, Field, Sheet, T, useToast } from "./ui";

/**
 * Prompt (or suggest one from the character) -> style -> 4 options -> pick one.
 * Generations run as server jobs; if you leave the app, a notification says when they're ready.
 */
export function AvatarGenerator({
  open,
  onClose,
  onDone,
  characterId,
  form,
}: {
  open: boolean;
  onClose: () => void;
  onDone: (url: string) => void;
  characterId?: string;
  form: { name?: string; tagline?: string; description?: string };
}) {
  const { c } = useTheme();
  const toast = useToast();
  const [prompt, setPrompt] = useState("");
  const [style, setStyle] = useState("portrait");
  const [jobId, setJobId] = useState<string | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [suggesting, setSuggesting] = useState(false);

  const status = useQuery({
    queryKey: ["image-status"],
    queryFn: () => api.imageStatus(),
    enabled: open,
  });
  const styles = useQuery({
    queryKey: ["image-styles"],
    queryFn: () => api.imageStyles(),
    enabled: open,
  });
  const job = useQuery({
    queryKey: ["job", jobId],
    queryFn: () => api.job(jobId!),
    enabled: !!jobId,
    refetchInterval: (q) => {
      const s = q.state.data?.status;
      return s === "done" || s === "error" ? false : 1500;
    },
  });
  const images = (job.data?.result?.images as string[] | undefined) ?? [];
  const failed = job.data?.status === "error";
  const working = !!jobId && !images.length && !failed;

  useEffect(() => {
    if (failed) toast(job.data?.error || "Generation failed", "error");
  }, [failed, job.data?.error, toast]);

  const reset = () => {
    setJobId(null);
    setPicked(null);
  };

  const suggest = async () => {
    setSuggesting(true);
    try {
      const r = await api.request<{ prompt: string }>("POST", "/images/prompt", {
        name: form.name ?? "",
        tagline: form.tagline ?? "",
        description: form.description ?? "",
      });
      setPrompt(r.prompt);
    } catch (e) {
      toast(errorText(e), "error");
    } finally {
      setSuggesting(false);
    }
  };

  const generate = async () => {
    setPicked(null);
    try {
      const j = await api.generateAvatars({
        prompt: prompt.trim(),
        style,
        character_id: characterId,
      });
      setJobId(j.id);
    } catch (e) {
      toast(errorText(e), "error");
    }
  };

  return (
    <Sheet open={open} onClose={onClose} title="Generate an avatar">
      {status.data && !status.data.configured ? (
        <T tone="ink2" style={{ paddingBottom: 12 }}>
          Image generation isn&apos;t set up on this server yet. An admin can connect ComfyUI,
          AUTOMATIC1111/Forge, an OpenAI-compatible images API or fal.ai in the admin panel.
        </T>
      ) : (
        <View style={{ gap: 14, paddingBottom: 8 }}>
          <Field
            label="Describe the picture"
            value={prompt}
            onChangeText={setPrompt}
            multiline
            placeholder="A weathered lighthouse keeper with a kind smile, rain gear, warm lamplight"
          />
          <Button
            label="Write it from the character"
            variant="ghost"
            small
            loading={suggesting}
            icon={<Sparkles size={16} color={c.ink2} />}
            onPress={suggest}
            style={{ alignSelf: "flex-start" }}
          />
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ gap: 8 }}
          >
            {(styles.data ?? []).map((s) => (
              <Chip
                key={s.id}
                label={s.label}
                active={style === s.id}
                onPress={() => setStyle(s.id)}
              />
            ))}
          </ScrollView>

          {(working || images.length > 0) && (
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
              {working
                ? [0, 1, 2, 3].map((i) => (
                    <View
                      key={i}
                      style={{
                        width: "47%",
                        aspectRatio: 1,
                        borderRadius: radius.card,
                        backgroundColor: c.surface,
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      {i === 0 && <ActivityIndicator color={c.ember} />}
                    </View>
                  ))
                : images.map((u, i) => (
                    <Pressable
                      key={u}
                      accessibilityRole="radio"
                      accessibilityState={{ checked: picked === u }}
                      accessibilityLabel={`Option ${i + 1}`}
                      onPress={() => setPicked(u)}
                      style={{
                        width: "47%",
                        aspectRatio: 1,
                        borderRadius: radius.card,
                        overflow: "hidden",
                        borderWidth: 3,
                        borderColor: picked === u ? c.ember : "transparent",
                      }}
                    >
                      <Image source={{ uri: media(u) }} style={{ flex: 1 }} contentFit="cover" />
                    </Pressable>
                  ))}
            </View>
          )}
          {working && (
            <T size="sm" tone="ink3" accessibilityLiveRegion="polite">
              {job.data?.status === "running" ? "Painting…" : "Waiting for the image server…"} You
              can leave this screen; you&apos;ll get a notification when they&apos;re ready.
            </T>
          )}

          <View style={{ flexDirection: "row", gap: 10 }}>
            {images.length > 0 || failed ? (
              <>
                <Button
                  label="Try again"
                  variant="secondary"
                  onPress={() => (reset(), void generate())}
                  style={{ flex: 1 }}
                />
                <Button
                  label="Use this one"
                  disabled={!picked}
                  onPress={() => {
                    if (picked) onDone(picked);
                    reset();
                  }}
                  style={{ flex: 1 }}
                />
              </>
            ) : (
              <Button
                label="Generate 4 options"
                onPress={generate}
                loading={working}
                disabled={prompt.trim().length < 3}
                style={{ flex: 1 }}
              />
            )}
          </View>
        </View>
      )}
    </Sheet>
  );
}
