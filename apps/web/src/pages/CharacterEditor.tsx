import type { Character, CharacterInput, Visibility } from "@persona/shared";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { ChevronDown, Globe, Link2, Lock, Trash2, Upload, X } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useNavigate, useParams } from "react-router";
import { Avatar } from "../components/Avatar";
import { ConfirmModal } from "../components/Modal";
import { api } from "../lib/api";
import { errorText, useToast } from "../lib/toast";
import { EditorExtras } from "./editorExtras";

const EMPTY: Required<Omit<CharacterInput, "llm_params">> & { llm_params: Record<string, number> } =
  {
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
type Form = typeof EMPTY;

const VIS: { id: Visibility; label: string; hint: string; icon: ReactNode }[] = [
  { id: "public", label: "Public", hint: "Listed on Discover", icon: <Globe size={16} /> },
  { id: "unlisted", label: "Unlisted", hint: "Anyone with the link", icon: <Link2 size={16} /> },
  { id: "private", label: "Private", hint: "Only you", icon: <Lock size={16} /> },
];

function Field({
  id,
  label,
  hint,
  count,
  max,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  count?: number;
  max?: number;
  children: ReactNode;
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <label className="label" htmlFor={id}>
          {label}
        </label>
        {max !== undefined && (
          <span
            className={clsx("text-xs tabular-nums", (count ?? 0) > max ? "text-err" : "text-ink-3")}
          >
            {count}/{max}
          </span>
        )}
      </div>
      {children}
      {hint && <p className="hint">{hint}</p>}
    </div>
  );
}

function TagInput({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const [draft, setDraft] = useState("");
  const add = () => {
    const t = draft.trim().toLowerCase().replace(/,/g, "");
    if (t && !value.includes(t) && value.length < 20) onChange([...value, t.slice(0, 32)]);
    setDraft("");
  };
  return (
    <div className="field flex flex-wrap gap-1.5 items-center min-h-11 py-1.5">
      {value.map((t) => (
        <span
          key={t}
          className="inline-flex items-center gap-1 rounded-full bg-surface pl-2.5 pr-1 h-7 text-sm"
        >
          {t}
          <button
            type="button"
            className="rounded-full p-0.5 hover:bg-line"
            onClick={() => onChange(value.filter((x) => x !== t))}
            aria-label={`Remove tag ${t}`}
          >
            <X size={13} />
          </button>
        </span>
      ))}
      <input
        id="tags"
        className="flex-1 min-w-24 bg-transparent focus:outline-none text-sm"
        placeholder={value.length ? "" : "fantasy, mentor, comedy…"}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === ",") {
            e.preventDefault();
            add();
          } else if (e.key === "Backspace" && !draft && value.length) onChange(value.slice(0, -1));
        }}
        onBlur={add}
      />
    </div>
  );
}

export function CharacterEditor() {
  const { characterId } = useParams();
  const editing = !!characterId;
  const navigate = useNavigate();
  const toast = useToast();
  const qc = useQueryClient();
  const [form, setForm] = useState<Form>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [advanced, setAdvanced] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const existing = useQuery({
    queryKey: ["character", characterId],
    queryFn: () => api.character(characterId!),
    enabled: editing,
  });
  const models = useQuery({ queryKey: ["models"], queryFn: api.models, staleTime: 60_000 });

  useEffect(() => {
    const c = existing.data;
    if (!c) return;
    setForm({
      name: c.name,
      tagline: c.tagline,
      description: c.description,
      greeting: c.greeting,
      definition: c.definition ?? "",
      personality: c.personality ?? "",
      scenario: c.scenario ?? "",
      avatar_url: c.avatar_url,
      voice_id: c.voice_id,
      visibility: c.visibility,
      tags: c.tags,
      creator_credit: c.creator_credit,
      llm_model: c.llm_model,
      llm_params: c.llm_params ?? {},
    });
    if (c.definition || c.personality || c.scenario) setAdvanced(true);
  }, [existing.data]);

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }));

  const upload = async (file: File) => {
    setUploading(true);
    try {
      const { url } = await api.uploadImage(file);
      set("avatar_url", url);
    } catch (e) {
      toast(errorText(e), "error");
    } finally {
      setUploading(false);
    }
  };

  const save = async () => {
    setError("");
    if (!form.name.trim()) return setError("Give your character a name.");
    setBusy(true);
    try {
      const body: CharacterInput = {
        ...form,
        name: form.name.trim(),
        llm_model: form.llm_model || null,
      };
      let c: Character;
      if (editing) c = await api.updateCharacter(characterId!, body);
      else c = await api.createCharacter(body);
      qc.setQueryData(["character", c.id], c);
      void qc.invalidateQueries({ queryKey: ["discover"] });
      toast(editing ? "Changes saved" : `${c.name} is ready`, "success");
      navigate(editing ? `/character/${c.id}` : `/c/${c.id}`);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    try {
      await api.deleteCharacter(characterId!);
      void qc.invalidateQueries();
      navigate("/");
    } catch (e) {
      toast(errorText(e), "error");
    }
  };

  if (editing && existing.isLoading)
    return (
      <div className="mx-auto max-w-2xl p-6">
        <div className="skeleton h-96 rounded-card" />
      </div>
    );
  if (editing && existing.data && !existing.data.is_owner && !existing.data.definition) {
    return (
      <div className="p-8 text-center text-ink-2">You can only edit characters you created.</div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-8 pb-28">
      <div className="flex items-center justify-between gap-3 mb-6">
        <h1 className="text-2xl font-bold">
          {editing ? `Edit ${existing.data?.name ?? "character"}` : "Create a character"}
        </h1>
        {!editing && (
          <EditorExtras.ImportButton onImported={(c) => navigate(`/character/${c.id}/edit`)} />
        )}
      </div>

      <form
        className="space-y-6"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <div className="flex items-center gap-4">
          <Avatar src={form.avatar_url} name={form.name || "?"} size={96} />
          <div className="flex flex-wrap gap-2">
            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="hidden"
              onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])}
            />
            <button
              type="button"
              className="btn-secondary"
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
            >
              <Upload size={16} /> {uploading ? "Uploading…" : "Upload avatar"}
            </button>
            <EditorExtras.GenerateAvatar
              form={form}
              onPick={(url) => set("avatar_url", url)}
              characterId={characterId}
            />
            {form.avatar_url && (
              <button type="button" className="btn-ghost" onClick={() => set("avatar_url", null)}>
                Remove
              </button>
            )}
          </div>
        </div>

        <Field id="name" label="Name" count={form.name.length} max={64}>
          <input
            id="name"
            className="field"
            value={form.name}
            maxLength={64}
            onChange={(e) => set("name", e.target.value)}
            placeholder="e.g. Captain Vela"
            required
          />
        </Field>
        <Field
          id="tagline"
          label="Tagline"
          hint="One line shown on Discover cards."
          count={form.tagline.length}
          max={140}
        >
          <input
            id="tagline"
            className="field"
            value={form.tagline}
            maxLength={140}
            onChange={(e) => set("tagline", e.target.value)}
            placeholder="A starship captain with a dry wit"
          />
        </Field>
        <Field
          id="description"
          label="Description"
          hint="Who they are, how they talk, what they want. This shapes every reply."
        >
          <textarea
            id="description"
            className="field min-h-32 resize-y"
            value={form.description}
            onChange={(e) => set("description", e.target.value)}
          />
        </Field>
        <Field
          id="greeting"
          label="Greeting"
          hint="The first message in every new chat. {{user}} becomes the user's name."
        >
          <textarea
            id="greeting"
            className="field min-h-24 resize-y"
            value={form.greeting}
            onChange={(e) => set("greeting", e.target.value)}
            placeholder="*looks up from the star charts* Oh. You're the new navigator?"
          />
        </Field>
        <Field id="tags" label="Tags">
          <TagInput value={form.tags} onChange={(v) => set("tags", v)} />
        </Field>

        <fieldset>
          <legend className="label">Visibility</legend>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            {VIS.map((v) => (
              <label
                key={v.id}
                className={clsx(
                  "flex items-start gap-2.5 rounded-control border p-3 cursor-pointer transition-colors",
                  form.visibility === v.id
                    ? "border-ember bg-ember-soft"
                    : "border-line hover:bg-surface",
                )}
              >
                <input
                  type="radio"
                  name="visibility"
                  className="sr-only"
                  checked={form.visibility === v.id}
                  onChange={() => set("visibility", v.id)}
                />
                <span className={form.visibility === v.id ? "text-ember" : "text-ink-3"}>
                  {v.icon}
                </span>
                <span>
                  <span className="block text-sm font-semibold">{v.label}</span>
                  <span className="block text-xs text-ink-3">{v.hint}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        <EditorExtras.VoicePicker value={form.voice_id} onChange={(v) => set("voice_id", v)} />

        <div className="rounded-card border border-line">
          <button
            type="button"
            className="flex w-full items-center justify-between px-4 py-3 font-semibold"
            onClick={() => setAdvanced((a) => !a)}
            aria-expanded={advanced}
          >
            Advanced
            <ChevronDown
              size={18}
              className={clsx("transition-transform", advanced && "rotate-180")}
            />
          </button>
          {advanced && (
            <div className="space-y-5 px-4 pb-5">
              <Field
                id="definition"
                label="Definition (example dialog)"
                hint="Example exchanges that teach the voice. Separate examples with a line containing <START>. Use {{char}} and {{user}}."
              >
                <textarea
                  id="definition"
                  className="field min-h-40 resize-y font-mono text-sm"
                  value={form.definition}
                  onChange={(e) => set("definition", e.target.value)}
                  placeholder={
                    "{{user}}: What's our heading?\n{{char}}: *taps the console* Wherever the coffee is."
                  }
                />
              </Field>
              <Field id="personality" label="Personality">
                <textarea
                  id="personality"
                  className="field min-h-20 resize-y"
                  value={form.personality}
                  onChange={(e) => set("personality", e.target.value)}
                />
              </Field>
              <Field id="scenario" label="Scenario">
                <textarea
                  id="scenario"
                  className="field min-h-20 resize-y"
                  value={form.scenario}
                  onChange={(e) => set("scenario", e.target.value)}
                />
              </Field>
              <Field
                id="credit"
                label="Creator credit"
                hint="Shown as the author, e.g. when importing someone else's card."
              >
                <input
                  id="credit"
                  className="field"
                  value={form.creator_credit}
                  onChange={(e) => set("creator_credit", e.target.value)}
                />
              </Field>
              {(models.data?.length ?? 0) > 1 && (
                <Field id="model" label="Model" hint="Models offered by this server's admin.">
                  <select
                    id="model"
                    className="field"
                    value={form.llm_model ?? ""}
                    onChange={(e) => set("llm_model", e.target.value || null)}
                  >
                    {models.data!.map((m) => (
                      <option key={m.id} value={m.default ? "" : m.id}>
                        {m.label}
                        {m.default ? " (default)" : ""}
                      </option>
                    ))}
                  </select>
                </Field>
              )}
              <Field
                id="temp"
                label={`Temperature: ${form.llm_params.temperature ?? "default"}`}
                hint="Higher is more creative, lower is more focused."
              >
                <input
                  id="temp"
                  type="range"
                  min={0}
                  max={2}
                  step={0.05}
                  className="w-full accent-[var(--ember)]"
                  value={form.llm_params.temperature ?? 0.8}
                  onChange={(e) =>
                    set("llm_params", { ...form.llm_params, temperature: Number(e.target.value) })
                  }
                />
              </Field>
            </div>
          )}
        </div>

        {error && (
          <p role="alert" className="text-sm text-err">
            {error}
          </p>
        )}

        <div className="fixed bottom-0 inset-x-0 md:left-72 z-(--z-sticky) border-t border-line bg-bg/95 px-4 py-3 pb-[max(12px,env(safe-area-inset-bottom))]">
          <div className="mx-auto max-w-2xl flex items-center gap-2">
            {editing && (
              <button
                type="button"
                className="btn-ghost text-err"
                onClick={() => setConfirmDelete(true)}
              >
                <Trash2 size={16} /> Delete
              </button>
            )}
            <button type="button" className="btn-ghost ml-auto" onClick={() => navigate(-1)}>
              Cancel
            </button>
            <button className="btn-primary" disabled={busy}>
              {busy ? "Saving…" : editing ? "Save changes" : "Create character"}
            </button>
          </div>
        </div>
      </form>
      <ConfirmModal
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        onConfirm={remove}
        title="Delete this character?"
        body="Everyone's chats with this character will be deleted too. This can't be undone."
        confirmLabel="Delete character"
        danger
      />
    </div>
  );
}
