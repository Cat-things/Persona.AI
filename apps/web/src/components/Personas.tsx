import type { Persona } from "@persona/shared";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { Check, Pencil, Plus, Trash2, Upload } from "lucide-react";
import { useRef, useState } from "react";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { errorText, useToast } from "../lib/toast";
import { Avatar } from "./Avatar";
import { ConfirmModal, Modal } from "./Modal";

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
  const [d, setD] = useState<Draft>(initial ?? EMPTY);
  const [busy, setBusy] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const toast = useToast();
  const qc = useQueryClient();
  const { setUser } = useAuth();
  const refresh = async () => setUser(await api.me());

  const save = async () => {
    setBusy(true);
    try {
      const p = initial
        ? await api.updatePersona(initial.id, d)
        : await api.createPersona({ ...d, name: d.name.trim() });
      await qc.invalidateQueries({ queryKey: ["personas"] });
      await refresh();
      onSaved(p);
    } catch (e) {
      toast(errorText(e), "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (d.name.trim()) void save();
      }}
    >
      <div className="flex items-center gap-4">
        <Avatar src={d.avatar_url} name={d.name || "?"} size={56} />
        <input
          ref={file}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="hidden"
          onChange={async (e) => {
            const f = e.target.files?.[0];
            if (!f) return;
            try {
              const { url } = await api.uploadImage(f);
              setD((x) => ({ ...x, avatar_url: url }));
            } catch (err) {
              toast(errorText(err), "error");
            }
          }}
        />
        <button type="button" className="btn-secondary" onClick={() => file.current?.click()}>
          <Upload size={16} /> Picture
        </button>
      </div>
      <div>
        <label className="label" htmlFor="pn">
          Name
        </label>
        <input
          id="pn"
          className="field"
          value={d.name}
          maxLength={64}
          required
          autoFocus
          onChange={(e) => setD({ ...d, name: e.target.value })}
        />
      </div>
      <div>
        <label className="label" htmlFor="pd">
          About you
        </label>
        <textarea
          id="pd"
          className="field min-h-24"
          value={d.description}
          maxLength={4000}
          placeholder="What characters should know: appearance, background, how you talk."
          onChange={(e) => setD({ ...d, description: e.target.value })}
        />
        <p className="hint">Characters see this in every chat where you use this persona.</p>
      </div>
      <label className="flex items-center gap-3 cursor-pointer">
        <input
          type="checkbox"
          className="size-4 accent-[var(--ember)]"
          checked={d.is_default}
          onChange={(e) => setD({ ...d, is_default: e.target.checked })}
        />
        <span className="text-sm">Use for new chats</span>
      </label>
      <div className="flex justify-end gap-2">
        <button type="button" className="btn-ghost" onClick={onCancel}>
          Cancel
        </button>
        <button className="btn-primary" disabled={busy || !d.name.trim()}>
          {initial ? "Save persona" : "Create persona"}
        </button>
      </div>
    </form>
  );
}

/** Settings section: list, create, edit, delete, choose default. */
export function PersonaSettings({
  Section,
}: {
  Section: typeof import("../pages/Settings").Section;
}) {
  const { data = [], isLoading } = usePersonas();
  const [editing, setEditing] = useState<Persona | "new" | null>(null);
  const [deleting, setDeleting] = useState<Persona | null>(null);
  const qc = useQueryClient();
  const toast = useToast();
  const { setUser } = useAuth();
  const refresh = async () => setUser(await api.me());

  return (
    <Section
      title="Personas"
      description="Who you are in a chat. Pick one per chat, or set a default for new chats."
    >
      {isLoading ? (
        <div className="skeleton h-14 rounded-control" />
      ) : data.length === 0 ? (
        <p className="text-sm text-ink-2">
          No personas yet. Without one, characters know you by your display name.
        </p>
      ) : (
        <ul className="divide-y divide-line -my-2">
          {data.map((p) => (
            <li key={p.id} className="flex items-center gap-3 py-2">
              <Avatar src={p.avatar_url} name={p.name} size={40} />
              <div className="min-w-0 flex-1">
                <p className="font-semibold truncate">
                  {p.name}
                  {p.is_default && (
                    <span className="chip h-5 ml-2 text-[11px] align-middle">Default</span>
                  )}
                </p>
                {p.description && <p className="text-xs text-ink-3 truncate">{p.description}</p>}
              </div>
              <button
                className="icon-btn size-9"
                aria-label={`Edit ${p.name}`}
                onClick={() => setEditing(p)}
              >
                <Pencil size={16} />
              </button>
              <button
                className="icon-btn size-9"
                aria-label={`Delete ${p.name}`}
                onClick={() => setDeleting(p)}
              >
                <Trash2 size={16} />
              </button>
            </li>
          ))}
        </ul>
      )}
      <button className="btn-secondary" onClick={() => setEditing("new")}>
        <Plus size={16} /> New persona
      </button>

      <Modal
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
      </Modal>
      <ConfirmModal
        open={!!deleting}
        onClose={() => setDeleting(null)}
        title={`Delete ${deleting?.name ?? "persona"}?`}
        body="Chats that use it keep their messages and switch to your display name."
        confirmLabel="Delete persona"
        danger
        onConfirm={async () => {
          if (!deleting) return;
          try {
            await api.deletePersona(deleting.id);
            await qc.invalidateQueries({ queryKey: ["personas"] });
            await refresh();
          } catch (e) {
            toast(errorText(e), "error");
          }
          setDeleting(null);
        }}
      />
    </Section>
  );
}

/** Chat-level picker: switch who you are in this chat. */
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
  const { data = [] } = usePersonas();
  const { user } = useAuth();
  const [creating, setCreating] = useState(false);
  const options: { id: string | null; name: string; avatar: string | null; sub: string }[] = [
    {
      id: null,
      name: user?.display_name || user?.username || "Me",
      avatar: user?.avatar_url ?? null,
      sub: "Your profile",
    },
    ...data.map((p) => ({ id: p.id, name: p.name, avatar: p.avatar_url, sub: p.description })),
  ];
  return (
    <Modal open={open} onClose={onClose} title={creating ? "New persona" : "Talk as"}>
      {creating ? (
        <PersonaForm
          onCancel={() => setCreating(false)}
          onSaved={async (p) => {
            setCreating(false);
            await onPick(p.id);
          }}
        />
      ) : (
        <div className="space-y-1">
          {options.map((o) => (
            <button
              key={o.id ?? "me"}
              className={clsx(
                "flex w-full items-center gap-3 rounded-control px-2 py-2 text-left hover:bg-surface-2",
                o.id === current && "bg-surface-2",
              )}
              aria-pressed={o.id === current}
              onClick={() => void onPick(o.id)}
            >
              <Avatar src={o.avatar} name={o.name} size={40} />
              <span className="min-w-0 flex-1">
                <span className="block font-semibold truncate">{o.name}</span>
                {o.sub && <span className="block text-xs text-ink-3 truncate">{o.sub}</span>}
              </span>
              {o.id === current && <Check size={18} className="text-ember" />}
            </button>
          ))}
          <button className="btn-ghost mt-2" onClick={() => setCreating(true)}>
            <Plus size={16} /> New persona
          </button>
        </div>
      )}
    </Modal>
  );
}
