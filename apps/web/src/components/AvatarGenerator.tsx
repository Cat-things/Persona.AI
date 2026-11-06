import type { CharacterInput, Job } from "@persona/shared";
import { useQuery } from "@tanstack/react-query";
import clsx from "clsx";
import { RefreshCw, Sparkles, Wand2 } from "lucide-react";
import { useEffect, useState } from "react";
import { api, media } from "../lib/api";
import { errorText, useToast } from "../lib/toast";
import { AvatarCropper } from "./AvatarCropper";
import { Modal } from "./Modal";

type Step = "prompt" | "pick" | "crop";

export function GenerateAvatarButton({
  form,
  onPick,
  characterId,
}: {
  form: CharacterInput;
  onPick: (url: string) => void;
  characterId?: string;
}) {
  const [open, setOpen] = useState(false);
  const status = useQuery({
    queryKey: ["image-status"],
    queryFn: api.imageStatus,
    staleTime: 60_000,
  });
  return (
    <>
      <button type="button" className="btn-secondary" onClick={() => setOpen(true)}>
        <Sparkles size={16} /> Generate
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title="Generate an avatar" wide>
        {status.data && !status.data.configured ? (
          <div className="rounded-card bg-surface-2 p-4 text-sm text-ink-2">
            <p className="font-semibold text-ink">
              Image generation isn't set up on this server yet.
            </p>
            <p className="mt-1">
              An admin can connect ComfyUI, AUTOMATIC1111/Forge, an OpenAI-compatible images API or
              fal.ai in <strong>Admin → Providers</strong>. Re-running the installer with{" "}
              <code>--image-gen comfyui</code> sets up ComfyUI.
            </p>
          </div>
        ) : (
          open && (
            <GeneratorBody
              form={form}
              characterId={characterId}
              onDone={(url) => {
                onPick(url);
                setOpen(false);
              }}
            />
          )
        )}
      </Modal>
    </>
  );
}

function GeneratorBody({
  form,
  characterId,
  onDone,
}: {
  form: CharacterInput;
  characterId?: string;
  onDone: (url: string) => void;
}) {
  const toast = useToast();
  const styles = useQuery({
    queryKey: ["image-styles"],
    queryFn: api.imageStyles,
    staleTime: Infinity,
  });
  const [prompt, setPrompt] = useState(() => [form.name, form.tagline].filter(Boolean).join(", "));
  const [style, setStyle] = useState("portrait");
  const [step, setStep] = useState<Step>("prompt");
  const [jobId, setJobId] = useState<string | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [suggesting, setSuggesting] = useState(false);
  const [saving, setSaving] = useState(false);

  const job = useQuery<Job>({
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

  useEffect(() => {
    if (failed) toast(job.data?.error || "Generation failed", "error");
  }, [failed, job.data?.error, toast]);

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
    try {
      const j = await api.generateAvatars({
        prompt: prompt.trim(),
        style,
        character_id: characterId,
      });
      setJobId(j.id);
      setStep("pick");
    } catch (e) {
      toast(errorText(e), "error");
    }
  };

  const finish = async (blob: Blob) => {
    setSaving(true);
    try {
      const { url } = await api.uploadImage(new File([blob], "avatar.png", { type: "image/png" }));
      onDone(url);
    } catch (e) {
      toast(errorText(e), "error");
    } finally {
      setSaving(false);
    }
  };

  if (step === "crop" && picked) {
    return (
      <AvatarCropper
        src={media(picked)!}
        busy={saving}
        onCancel={() => setStep("pick")}
        onDone={finish}
      />
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <div className="flex items-end justify-between gap-2 mb-1.5">
          <label className="label mb-0" htmlFor="avatar-prompt">
            Describe the picture
          </label>
          <button
            type="button"
            className="btn-ghost h-8 text-xs"
            onClick={suggest}
            disabled={suggesting || !(form.description || form.name)}
          >
            <Wand2 size={14} /> {suggesting ? "Writing…" : "Write from description"}
          </button>
        </div>
        <textarea
          id="avatar-prompt"
          className="field min-h-24 resize-y"
          value={prompt}
          maxLength={1500}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="A weathered starship captain with short silver hair and a navy coat, warm cockpit lights"
        />
      </div>
      <fieldset>
        <legend className="label">Style</legend>
        <div className="flex flex-wrap gap-2">
          {styles.data?.map((s) => (
            <button
              key={s.id}
              type="button"
              className="chip"
              aria-pressed={style === s.id}
              onClick={() => setStyle(s.id)}
            >
              {s.label}
            </button>
          ))}
        </div>
      </fieldset>

      {step === "pick" && (
        <div>
          <p className="text-sm text-ink-2 mb-2" role="status">
            {failed
              ? "Generation failed. Adjust the prompt and try again."
              : images.length
                ? "Pick one to crop."
                : job.data?.status === "running"
                  ? "Generating four options…"
                  : "Waiting for the generator…"}
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {images.length
              ? images.map((u) => (
                  <button
                    key={u}
                    type="button"
                    className={clsx(
                      "aspect-square overflow-hidden rounded-card border-2 transition-colors",
                      picked === u ? "border-ember" : "border-transparent hover:border-line",
                    )}
                    onClick={() => {
                      setPicked(u);
                      setStep("crop");
                    }}
                    aria-label="Use this image"
                  >
                    <img src={media(u)} alt="" className="size-full object-cover" />
                  </button>
                ))
              : !failed &&
                Array.from({ length: 4 }, (_, i) => (
                  <div key={i} className="skeleton aspect-square rounded-card" />
                ))}
          </div>
          <p className="hint mt-2">
            You'll get a notification when they're ready if you leave this screen.
          </p>
        </div>
      )}

      <div className="flex justify-end gap-2">
        <button
          type="button"
          className="btn-primary"
          onClick={generate}
          disabled={prompt.trim().length < 3 || (step === "pick" && !failed && !images.length)}
        >
          {step === "pick" ? <RefreshCw size={16} /> : <Sparkles size={16} />}
          {step === "pick" ? "Generate again" : "Generate 4"}
        </button>
      </div>
    </div>
  );
}
