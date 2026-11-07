import type { Report } from "@persona/shared";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { Check, Copy, RefreshCw, Trash2 } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router";
import { Avatar } from "../components/Avatar";
import { api } from "../lib/api";
import { useUser } from "../lib/auth";
import { relativeTime } from "../lib/time";
import { errorText, useToast } from "../lib/toast";
import { Section } from "./Settings";

const TABS = [
  "overview",
  "providers",
  "instance",
  "users",
  "characters",
  "reports",
  "invites",
] as const;
type Tab = (typeof TABS)[number];

type Values = Record<string, unknown>;

function useSettings() {
  return useQuery({ queryKey: ["admin-settings"], queryFn: api.admin.settings });
}

function TextSetting({
  k,
  label,
  values,
  onChange,
  type = "text",
  hint,
  placeholder,
}: {
  k: string;
  label: string;
  values: Values;
  onChange: (k: string, v: unknown) => void;
  type?: string;
  hint?: string;
  placeholder?: string;
}) {
  const isSecret = k.endsWith("_api_key");
  return (
    <div>
      <label className="label" htmlFor={k}>
        {label}
      </label>
      <input
        id={k}
        className="field"
        type={isSecret ? "password" : type}
        autoComplete="off"
        placeholder={isSecret && values[`${k}_set`] ? "Saved. Type to replace" : placeholder}
        value={isSecret ? ((values[`__${k}`] as string) ?? "") : String(values[k] ?? "")}
        onChange={(e) => {
          const v = type === "number" ? Number(e.target.value) : e.target.value;
          if (isSecret) {
            onChange(`__${k}`, e.target.value);
            onChange(k, e.target.value);
          } else onChange(k, v);
        }}
      />
      {hint && <p className="hint">{hint}</p>}
    </div>
  );
}

function SelectSetting({
  k,
  label,
  options,
  values,
  onChange,
  hint,
}: {
  k: string;
  label: string;
  options: [string, string][];
  values: Values;
  onChange: (k: string, v: unknown) => void;
  hint?: string;
}) {
  return (
    <div>
      <label className="label" htmlFor={k}>
        {label}
      </label>
      <select
        id={k}
        className="field"
        value={String(values[k] ?? "")}
        onChange={(e) => onChange(k, e.target.value)}
      >
        {options.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
      {hint && <p className="hint">{hint}</p>}
    </div>
  );
}

function Toggle({
  checked,
  onChange,
  label,
  hint,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  hint?: string;
  disabled?: boolean;
}) {
  return (
    <label
      className={clsx(
        "flex items-start gap-3 cursor-pointer",
        disabled && "opacity-60 cursor-not-allowed",
      )}
    >
      <input
        type="checkbox"
        className="peer sr-only"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="mt-0.5 relative inline-flex h-6 w-10 shrink-0 rounded-full bg-surface-2 border border-line transition-colors peer-checked:bg-ember peer-checked:border-ember peer-focus-visible:outline-2 peer-focus-visible:outline-ember after:absolute after:top-0.5 after:left-0.5 after:size-4.5 after:rounded-full after:bg-ink after:transition-transform peer-checked:after:translate-x-4 peer-checked:after:bg-ember-ink" />
      <span>
        <span className="block text-sm font-semibold">{label}</span>
        {hint && <span className="block text-xs text-ink-3">{hint}</span>}
      </span>
    </label>
  );
}

function SettingsForm({
  render,
}: {
  render: (
    values: Values,
    onChange: (k: string, v: unknown) => void,
    cats: Record<string, string>,
  ) => ReactNode;
}) {
  const { data } = useSettings();
  const qc = useQueryClient();
  const toast = useToast();
  const [values, setValues] = useState<Values>({});
  const [dirty, setDirty] = useState<Record<string, unknown>>({});
  useEffect(() => {
    if (data) setValues(data.values);
  }, [data]);
  if (!data) return <div className="skeleton h-60 rounded-card" />;
  const onChange = (k: string, v: unknown) => {
    setValues((s) => ({ ...s, [k]: v }));
    if (!k.startsWith("__")) setDirty((d) => ({ ...d, [k]: v }));
  };
  const save = async () => {
    try {
      const body = Object.fromEntries(
        Object.entries(dirty).filter(([k, v]) => !(k.endsWith("_api_key") && v === "")),
      );
      await api.admin.patchSettings(body);
      setDirty({});
      void qc.invalidateQueries({ queryKey: ["admin-settings"] });
      void qc.invalidateQueries({ queryKey: ["admin-doctor"] });
      toast("Settings saved", "success");
    } catch (e) {
      toast(errorText(e), "error");
    }
  };
  return (
    <div className="space-y-5">
      {render(values, onChange, data.filter_categories)}
      <div className="sticky bottom-0 py-3 bg-bg flex justify-end gap-2">
        <button
          className="btn-ghost"
          disabled={!Object.keys(dirty).length}
          onClick={() => {
            setValues(data.values);
            setDirty({});
          }}
        >
          Discard
        </button>
        <button className="btn-primary" disabled={!Object.keys(dirty).length} onClick={save}>
          Save settings
        </button>
      </div>
    </div>
  );
}

function Overview() {
  const stats = useQuery({ queryKey: ["admin-stats"], queryFn: api.admin.stats });
  const doctor = useQuery({ queryKey: ["admin-doctor"], queryFn: api.admin.doctor });
  const [params] = useSearchParams();
  const color: Record<string, string> = {
    ok: "text-ok",
    warn: "text-warn",
    fail: "text-err",
    skip: "text-ink-3",
  };
  return (
    <div className="space-y-5">
      {params.get("welcome") && (
        <div className="rounded-card border border-ember bg-ember-soft p-5">
          <h2 className="font-bold">Your instance is ready</h2>
          <p className="text-sm text-ink-2 mt-1">
            You're the administrator. Check the health list below, then configure AI providers. When
            chat works,{" "}
            <Link className="text-ember font-semibold" to="/create">
              create your first character
            </Link>
            .
          </p>
        </div>
      )}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {Object.entries(stats.data ?? {}).map(([k, v]) => (
          <div key={k} className="rounded-card bg-surface px-4 py-3">
            <p className="text-xs text-ink-3 capitalize">{k.replace(/_/g, " ")}</p>
            <p className="text-xl font-bold tabular-nums">{v}</p>
          </div>
        ))}
      </div>
      <Section title="Health" description="Same checks as `persona doctor` on the server.">
        <button className="btn-ghost h-8 -mt-2" onClick={() => doctor.refetch()}>
          <RefreshCw size={14} className={doctor.isFetching ? "animate-spin" : ""} /> Re-run checks
        </button>
        <ul className="divide-y divide-line">
          {doctor.data?.map((r) => (
            <li key={r.name} className="flex items-baseline gap-3 py-2 text-sm">
              <span className={clsx("w-12 font-semibold uppercase text-xs", color[r.status])}>
                {r.status}
              </span>
              <span className="w-24 font-semibold">{r.name}</span>
              <span className="text-ink-2 min-w-0 break-words flex-1">{r.detail}</span>
            </li>
          ))}
        </ul>
      </Section>
    </div>
  );
}

function ModelList({
  values,
  onChange,
}: {
  values: Values;
  onChange: (k: string, v: unknown) => void;
}) {
  const initial = (
    (values.llm_models as (string | { id: string; context_tokens?: number })[]) ?? []
  )
    .map((e) =>
      typeof e === "string" ? e : `${e.id}${e.context_tokens ? `|${e.context_tokens}` : ""}`,
    )
    .join("\n");
  const [text, setText] = useState(initial);
  useEffect(() => setText(initial), [initial]);
  return (
    <div>
      <label className="label" htmlFor="llm_models">
        Extra models for per-character override
      </label>
      <textarea
        id="llm_models"
        className="field font-mono text-sm min-h-20"
        placeholder={"gemma3:12b\npersona-rp|8192"}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          onChange(
            "llm_models",
            e.target.value
              .split("\n")
              .map((l) => l.trim())
              .filter(Boolean)
              .map((l) => {
                const [id, ctx] = l.split("|");
                return ctx ? { id, context_tokens: Number(ctx) } : id;
              }),
          );
        }}
      />
      <p className="hint">
        One per line, optionally <code>model|context_tokens</code>. Creators can pick these; same
        endpoint and key.
      </p>
    </div>
  );
}

function Providers() {
  const models = useQuery({
    queryKey: ["admin-llm-models"],
    queryFn: api.admin.llmModels,
    retry: false,
  });
  return (
    <SettingsForm
      render={(v, on) => (
        <>
          <Section
            title="Language model"
            description="Any OpenAI-compatible server (Ollama, KoboldCpp, LM Studio, llama.cpp, vLLM, OpenRouter, OpenAI) or Anthropic."
          >
            <SelectSetting
              k="llm_provider"
              label="Provider type"
              values={v}
              onChange={on}
              options={[
                ["openai", "OpenAI-compatible"],
                ["anthropic", "Anthropic"],
                ["mock", "Demo (offline canned replies)"],
              ]}
            />
            <TextSetting
              k="llm_base_url"
              label="Base URL"
              values={v}
              onChange={on}
              placeholder="http://localhost:11434/v1"
              hint="Ollama: http://localhost:11434/v1 · LM Studio: http://localhost:1234/v1 · OpenRouter: https://openrouter.ai/api/v1"
            />
            <TextSetting
              k="llm_api_key"
              label="API key"
              values={v}
              onChange={on}
              hint="Stored on the server only. Leave empty for local servers."
            />
            <div>
              <TextSetting k="llm_model" label="Default model" values={v} onChange={on} />
              {!!models.data?.length && (
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {models.data.slice(0, 20).map((m) => (
                    <button
                      key={m}
                      type="button"
                      className="chip h-7 text-xs"
                      onClick={() => on("llm_model", m)}
                    >
                      {m}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="grid sm:grid-cols-2 gap-3">
              <TextSetting
                k="llm_context_tokens"
                label="Context size (tokens)"
                type="number"
                values={v}
                onChange={on}
              />
              <TextSetting
                k="llm_max_response_tokens"
                label="Max reply tokens"
                type="number"
                values={v}
                onChange={on}
              />
            </div>
            <ModelList values={v} onChange={on} />
          </Section>
          <Section title="Image generation" description="Used by the avatar generator.">
            <SelectSetting
              k="image_provider"
              label="Provider"
              values={v}
              onChange={on}
              options={[
                ["", "Not configured"],
                ["comfyui", "ComfyUI (local)"],
                ["a1111", "AUTOMATIC1111 / Forge (local)"],
                ["openai", "OpenAI-compatible images API"],
                ["fal", "fal.ai"],
                ["mock", "Demo (placeholder images)"],
              ]}
            />
            <TextSetting
              k="image_base_url"
              label="Base URL"
              values={v}
              onChange={on}
              placeholder="http://127.0.0.1:8188"
            />
            <TextSetting k="image_api_key" label="API key" values={v} onChange={on} />
            <TextSetting
              k="image_model"
              label="Model / checkpoint"
              values={v}
              onChange={on}
              hint="ComfyUI: checkpoint file name. OpenAI: e.g. gpt-image-1. fal: e.g. fal-ai/flux/schnell."
            />
          </Section>
          <Section title="Voices (text to speech)">
            <SelectSetting
              k="tts_provider"
              label="Provider"
              values={v}
              onChange={on}
              options={[
                ["kokoro", "Kokoro (local)"],
                ["piper", "Piper (local)"],
                ["xtts", "XTTS-v2 server (cloning)"],
                ["elevenlabs", "ElevenLabs"],
                ["openai", "OpenAI-compatible speech API"],
                ["none", "Off"],
              ]}
            />
            <TextSetting
              k="tts_base_url"
              label="Base URL"
              values={v}
              onChange={on}
              hint="XTTS / OpenAI-compatible servers only."
            />
            <TextSetting k="tts_api_key" label="API key" values={v} onChange={on} />
          </Section>
          <Section title="Speech recognition">
            <SelectSetting
              k="stt_provider"
              label="Provider"
              values={v}
              onChange={on}
              options={[
                ["faster-whisper", "faster-whisper (local)"],
                ["openai", "OpenAI-compatible Whisper API"],
                ["none", "Off"],
              ]}
            />
            <TextSetting
              k="stt_model"
              label="Model"
              values={v}
              onChange={on}
              hint="faster-whisper: tiny, base, small, medium, large-v3. OpenAI: whisper-1."
            />
            <TextSetting k="stt_base_url" label="Base URL" values={v} onChange={on} />
            <TextSetting k="stt_api_key" label="API key" values={v} onChange={on} />
          </Section>
        </>
      )}
    />
  );
}

function Instance() {
  return (
    <SettingsForm
      render={(v, on, cats) => (
        <>
          <Section title="Instance">
            <TextSetting k="instance_name" label="Instance name" values={v} onChange={on} />
            <Toggle
              label="Open registration"
              hint="Anyone who can reach this server can create an account."
              checked={!!v.allow_registration}
              onChange={(x) => on("allow_registration", x)}
            />
            <Toggle
              label="Invite-only"
              hint="New accounts need an invite code from the Invites tab."
              checked={!!v.invite_only}
              onChange={(x) => on("invite_only", x)}
            />
          </Section>
          <Section
            title="Content filter"
            description="Applies to public characters and to every reply. Sexual content involving minors is always blocked."
          >
            <Toggle
              label="Filter enabled"
              checked={!!v.content_filter}
              onChange={(x) => on("content_filter", x)}
            />
            {Object.entries(cats).map(([id, label]) => {
              const list = (v.filter_categories as string[]) ?? [];
              return (
                <Toggle
                  key={id}
                  label={label}
                  disabled={!v.content_filter}
                  checked={list.includes(id)}
                  onChange={(x) =>
                    on("filter_categories", x ? [...list, id] : list.filter((c) => c !== id))
                  }
                />
              );
            })}
          </Section>
        </>
      )}
    />
  );
}

function Users() {
  const me = useUser();
  const [q, setQ] = useState("");
  const { data, refetch } = useQuery({
    queryKey: ["admin-users", q],
    queryFn: () => api.admin.users(q || undefined),
  });
  const toast = useToast();
  const patch = async (id: string, body: { is_admin?: boolean; is_active?: boolean }) => {
    try {
      await api.admin.patchUser(id, body);
      void refetch();
    } catch (e) {
      toast(errorText(e), "error");
    }
  };
  return (
    <div className="space-y-3">
      <input
        className="field"
        placeholder="Search users"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        aria-label="Search users"
      />
      <ul className="divide-y divide-line rounded-card bg-surface">
        {data?.map((u) => (
          <li key={u.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
            <Avatar src={u.avatar_url} name={u.display_name || u.username} size={36} />
            <span className="min-w-0 flex-1">
              <span className="block font-semibold truncate">
                {u.display_name} <span className="text-ink-3 font-normal">@{u.username}</span>
              </span>
              <span className="block text-xs text-ink-3">
                {u.email ?? "no email"} · joined {relativeTime(u.created_at)}
              </span>
            </span>
            {u.is_admin && <span className="chip h-6 text-xs">admin</span>}
            {!u.is_active && <span className="chip h-6 text-xs text-err">disabled</span>}
            {u.id !== me.id && (
              <>
                <button
                  className="btn-ghost h-8"
                  onClick={() => patch(u.id, { is_admin: !u.is_admin })}
                >
                  {u.is_admin ? "Remove admin" : "Make admin"}
                </button>
                <button
                  className="btn-ghost h-8"
                  onClick={() => patch(u.id, { is_active: !u.is_active })}
                >
                  {u.is_active ? "Disable" : "Enable"}
                </button>
              </>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Characters() {
  const [q, setQ] = useState("");
  const { data, refetch } = useQuery({
    queryKey: ["admin-chars", q],
    queryFn: () => api.admin.characters(q || undefined),
  });
  const patch = async (id: string, body: { featured?: boolean; is_removed?: boolean }) => {
    await api.admin.patchCharacter(id, body);
    void refetch();
  };
  return (
    <div className="space-y-3">
      <input
        className="field"
        placeholder="Search characters"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        aria-label="Search characters"
      />
      <ul className="divide-y divide-line rounded-card bg-surface">
        {data?.map((c) => (
          <li key={c.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
            <Avatar src={c.avatar_url} name={c.name} size={36} />
            <Link to={`/character/${c.id}`} className="min-w-0 flex-1">
              <span className="block font-semibold truncate">{c.name}</span>
              <span className="block text-xs text-ink-3">
                {c.visibility} · by @{c.creator?.username ?? c.creator_credit}
              </span>
            </Link>
            <button
              className="btn-ghost h-8"
              onClick={() => patch(c.id, { featured: !c.featured })}
            >
              {c.featured ? (
                <>
                  <Check size={14} /> Featured
                </>
              ) : (
                "Feature"
              )}
            </button>
            <button
              className="btn-ghost h-8 text-err"
              onClick={() => patch(c.id, { is_removed: true })}
            >
              Remove
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Reports() {
  const [status, setStatus] = useState("open");
  const { data, refetch } = useQuery({
    queryKey: ["admin-reports", status],
    queryFn: () => api.admin.reports(status),
  });
  const set = async (r: Report, s: Report["status"]) => {
    await api.admin.patchReport(r.id, s);
    void refetch();
  };
  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        {["open", "resolved", "dismissed", "all"].map((s) => (
          <button
            key={s}
            className="chip capitalize"
            aria-pressed={status === s}
            onClick={() => setStatus(s)}
          >
            {s}
          </button>
        ))}
      </div>
      {!data?.length && <p className="text-sm text-ink-3">No reports here.</p>}
      <ul className="space-y-2">
        {data?.map((r) => (
          <li key={r.id} className="rounded-card bg-surface px-4 py-3">
            <p className="text-xs text-ink-3">
              {r.target_type} · {relativeTime(r.created_at)} · {r.status}
            </p>
            <p className="mt-1 text-sm chat-text">{r.reason}</p>
            <div className="flex gap-2 mt-2">
              {r.target_type === "character" && (
                <Link className="btn-ghost h-8" to={`/character/${r.target_id}`}>
                  Open character
                </Link>
              )}
              {r.status === "open" && (
                <button className="btn-secondary h-8" onClick={() => set(r, "resolved")}>
                  Mark resolved
                </button>
              )}
              {r.status === "open" && (
                <button className="btn-ghost h-8" onClick={() => set(r, "dismissed")}>
                  Dismiss
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Invites() {
  const { data, refetch } = useQuery({ queryKey: ["admin-invites"], queryFn: api.admin.invites });
  const toast = useToast();
  const [uses, setUses] = useState(1);
  const link = (code: string) => `${location.origin}/register?invite=${code}`;
  return (
    <div className="space-y-3">
      <div className="flex items-end gap-2">
        <div>
          <label className="label" htmlFor="uses">
            Uses
          </label>
          <input
            id="uses"
            type="number"
            min={1}
            max={1000}
            className="field w-24"
            value={uses}
            onChange={(e) => setUses(Number(e.target.value))}
          />
        </div>
        <button
          className="btn-primary"
          onClick={async () => {
            await api.admin.createInvite(uses);
            void refetch();
          }}
        >
          Create invite
        </button>
      </div>
      <ul className="divide-y divide-line rounded-card bg-surface">
        {data?.map((i) => (
          <li key={i.code} className="flex items-center gap-3 px-4 py-3">
            <code className="text-sm">{i.code}</code>
            <span className="text-xs text-ink-3 flex-1">
              {i.uses}/{i.max_uses} used
              {i.expires_at ? ` · expires ${new Date(i.expires_at).toLocaleDateString()}` : ""}
            </span>
            <button
              className="icon-btn"
              aria-label="Copy invite link"
              onClick={() => {
                void navigator.clipboard.writeText(link(i.code));
                toast("Invite link copied", "success");
              }}
            >
              <Copy size={15} />
            </button>
            <button
              className="icon-btn"
              aria-label="Delete invite"
              onClick={async () => {
                await api.admin.deleteInvite(i.code);
                void refetch();
              }}
            >
              <Trash2 size={15} />
            </button>
          </li>
        ))}
      </ul>
      {!data?.length && (
        <p className="text-sm text-ink-3">
          No invites yet. Turn on invite-only in the Instance tab to require them.
        </p>
      )}
    </div>
  );
}

export function AdminPage() {
  const user = useUser();
  const [params, setParams] = useSearchParams();
  const tab = (params.get("tab") as Tab) || "overview";
  if (!user.is_admin) return <div className="p-8 text-center text-ink-2">Admins only.</div>;
  const body: Record<Tab, ReactNode> = {
    overview: <Overview />,
    providers: <Providers />,
    instance: <Instance />,
    users: <Users />,
    characters: <Characters />,
    reports: <Reports />,
    invites: <Invites />,
  };
  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <h1 className="text-2xl font-bold mb-4">Admin</h1>
      <div
        className="flex gap-1 overflow-x-auto no-scrollbar border-b border-line mb-6 -mx-4 px-4"
        role="tablist"
      >
        {TABS.map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            className={clsx(
              "px-3 h-10 text-sm font-semibold capitalize border-b-2 -mb-px transition-colors",
              tab === t ? "border-ember text-ink" : "border-transparent text-ink-3 hover:text-ink",
            )}
            onClick={() => setParams({ tab: t })}
          >
            {t}
          </button>
        ))}
      </div>
      {body[tab]}
    </div>
  );
}
