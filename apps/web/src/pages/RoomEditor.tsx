import type { CharacterCard, Room } from "@persona/shared";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { Check, Search, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { Avatar } from "../components/Avatar";
import { ConfirmModal } from "../components/Modal";
import { api } from "../lib/api";
import { errorText, useToast } from "../lib/toast";

const MAX = 8;
const MODES: { id: Room["turn_mode"]; label: string; hint: string }[] = [
  {
    id: "auto",
    label: "Natural",
    hint: "Whoever you name answers; otherwise someone who hasn't spoken lately.",
  },
  {
    id: "round_robin",
    label: "Take turns",
    hint: "Characters answer in order, one after another.",
  },
  { id: "manual", label: "You choose", hint: "Nobody answers until you pick who speaks." },
];

export function RoomEditorPage() {
  const { id } = useParams();
  const editing = !!id;
  const navigate = useNavigate();
  const toast = useToast();
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [topic, setTopic] = useState("");
  const [mode, setMode] = useState<Room["turn_mode"]>("auto");
  const [picked, setPicked] = useState<CharacterCard[]>([]);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const existing = useQuery({
    queryKey: ["room", id],
    queryFn: () => api.room(id!),
    enabled: editing,
  });
  useEffect(() => {
    const r = existing.data;
    if (!r) return;
    setName(r.name);
    setTopic(r.topic);
    setMode(r.turn_mode);
    setPicked(r.members.map((m) => m.character));
  }, [existing.data]);

  const mine = useQuery({ queryKey: ["characters", "mine"], queryFn: () => api.myCharacters() });
  const liked = useQuery({
    queryKey: ["characters", "liked"],
    queryFn: () => api.likedCharacters(),
  });
  const search = useQuery({
    queryKey: ["discover", "room-picker", q],
    queryFn: () => api.discover({ q: q.trim() || undefined, sort: "popular", limit: 24 }),
  });

  const pool = useMemo(() => {
    const seen = new Set<string>();
    const out: CharacterCard[] = [];
    const add = (list?: CharacterCard[]) =>
      list?.forEach((c) => {
        if (seen.has(c.id)) return;
        if (q.trim() && !c.name.toLowerCase().includes(q.trim().toLowerCase())) return;
        seen.add(c.id);
        out.push(c);
      });
    add(mine.data);
    add(liked.data);
    add(search.data?.items);
    return out;
  }, [mine.data, liked.data, search.data, q]);

  const isPicked = (c: CharacterCard) => picked.some((p) => p.id === c.id);
  const toggle = (c: CharacterCard) =>
    setPicked((ps) =>
      ps.some((p) => p.id === c.id)
        ? ps.filter((p) => p.id !== c.id)
        : ps.length >= MAX
          ? ps
          : [...ps, c],
    );

  const valid = name.trim() && picked.length >= 2;

  const save = async () => {
    if (!valid) return;
    setBusy(true);
    const body = {
      name: name.trim(),
      topic: topic.trim(),
      turn_mode: mode,
      character_ids: picked.map((p) => p.id),
    };
    try {
      if (editing) {
        await api.updateRoom(id!, body);
        await qc.invalidateQueries({ queryKey: ["chats"] });
        await qc.invalidateQueries({ queryKey: ["room", id] });
        toast("Room saved", "success");
        navigate(-1);
      } else {
        const r = await api.createRoom(body);
        await qc.invalidateQueries({ queryKey: ["chats"] });
        navigate(`/chat/${r.chat_id}`);
      }
    } catch (e) {
      toast(errorText(e), "error");
    } finally {
      setBusy(false);
    }
  };

  if (editing && existing.isLoading)
    return (
      <div className="mx-auto max-w-2xl p-6">
        <div className="skeleton h-96 rounded-card" />
      </div>
    );
  if (editing && existing.isError)
    return <div className="p-8 text-center text-ink-2">This room doesn't exist anymore.</div>;

  return (
    <div className="mx-auto max-w-2xl px-4 py-8 pb-28">
      <h1 className="text-2xl font-bold mb-1">{editing ? "Edit room" : "New room"}</h1>
      <p className="text-sm text-ink-2 mb-6">
        A group chat with two to {MAX} characters. Mention someone by name to have them answer.
      </p>

      <form
        className="space-y-6"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <div>
          <label className="label" htmlFor="rn">
            Room name
          </label>
          <input
            id="rn"
            className="field"
            value={name}
            maxLength={64}
            required
            placeholder="The night shift"
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div>
          <label className="label" htmlFor="rt">
            Setting
          </label>
          <textarea
            id="rt"
            className="field min-h-20"
            value={topic}
            maxLength={4000}
            placeholder="Where are they, and what's going on? Every character sees this."
            onChange={(e) => setTopic(e.target.value)}
          />
        </div>

        <fieldset>
          <legend className="label">Who answers</legend>
          <div className="grid gap-2 sm:grid-cols-3">
            {MODES.map((m) => (
              <label
                key={m.id}
                className={clsx(
                  "cursor-pointer rounded-control border p-3 transition-colors",
                  mode === m.id ? "border-ember bg-ember-soft" : "border-line hover:bg-surface",
                )}
              >
                <input
                  type="radio"
                  name="mode"
                  className="sr-only"
                  checked={mode === m.id}
                  onChange={() => setMode(m.id)}
                />
                <span className="block text-sm font-semibold">{m.label}</span>
                <span className="block text-xs text-ink-2 mt-0.5">{m.hint}</span>
              </label>
            ))}
          </div>
        </fieldset>

        <div>
          <div className="flex items-baseline justify-between">
            <span className="label">Characters</span>
            <span className="text-xs text-ink-3 tabular-nums">
              {picked.length} / {MAX}
            </span>
          </div>
          {picked.length > 0 ? (
            <ol className="flex flex-wrap gap-2 mb-3">
              {picked.map((c, i) => (
                <li key={c.id} className="chip h-9 pl-1 pr-1.5 gap-2">
                  <Avatar src={c.avatar_url} name={c.name} size={28} />
                  <span className="text-sm">
                    <span className="text-ink-3 tabular-nums mr-1">{i + 1}.</span>
                    {c.name}
                  </span>
                  <button
                    type="button"
                    className="icon-btn size-6"
                    aria-label={`Remove ${c.name}`}
                    onClick={() => toggle(c)}
                  >
                    <X size={14} />
                  </button>
                </li>
              ))}
            </ol>
          ) : (
            <p className="hint mb-3">Pick at least two.</p>
          )}
          <div className="relative">
            <Search
              size={16}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-3 pointer-events-none"
            />
            <input
              className="field pl-9"
              value={q}
              placeholder="Search characters"
              aria-label="Search characters"
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
          <ul className="mt-2 max-h-80 overflow-y-auto scroll-thin rounded-control border border-line divide-y divide-line">
            {pool.length === 0 && (
              <li className="p-4 text-sm text-ink-2 text-center">
                {search.isLoading ? "Loading…" : "No characters match."}
              </li>
            )}
            {pool.map((c) => {
              const on = isPicked(c);
              const full = !on && picked.length >= MAX;
              return (
                <li key={c.id}>
                  <button
                    type="button"
                    className={clsx(
                      "flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-surface",
                      full && "opacity-50",
                    )}
                    aria-pressed={on}
                    disabled={full}
                    onClick={() => toggle(c)}
                  >
                    <Avatar src={c.avatar_url} name={c.name} size={36} />
                    <span className="min-w-0 flex-1">
                      <span className="block font-semibold truncate">{c.name}</span>
                      {c.tagline && (
                        <span className="block text-xs text-ink-3 truncate">{c.tagline}</span>
                      )}
                    </span>
                    <span
                      className={clsx(
                        "grid size-6 place-items-center rounded-full border",
                        on ? "bg-ember border-ember text-bg" : "border-line",
                      )}
                      aria-hidden="true"
                    >
                      {on && <Check size={14} />}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button className="btn-primary" disabled={busy || !valid}>
            {editing ? "Save room" : "Create room"}
          </button>
          <button type="button" className="btn-ghost" onClick={() => navigate(-1)}>
            Cancel
          </button>
          {editing && (
            <button
              type="button"
              className="btn-ghost text-err ml-auto"
              onClick={() => setConfirmDelete(true)}
            >
              <Trash2 size={16} /> Delete room
            </button>
          )}
        </div>
      </form>

      <ConfirmModal
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title="Delete this room?"
        body="The room and its whole conversation are deleted. The characters stay."
        confirmLabel="Delete room"
        danger
        onConfirm={async () => {
          try {
            await api.deleteRoom(id!);
            await qc.invalidateQueries({ queryKey: ["chats"] });
            navigate("/");
          } catch (e) {
            toast(errorText(e), "error");
          }
        }}
      />
    </div>
  );
}
