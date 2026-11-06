import type { Voice } from "@persona/shared";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { Check, Loader2, Mic, Play, Square, Trash2, Upload } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { api } from "../lib/api";
import { errorText, useToast } from "../lib/toast";
import { useCaps, useVoicePlayer, voicePlayer } from "../lib/voice";
import { Modal } from "./Modal";

export function PreviewButton({ voice }: { voice: Voice }) {
  const st = useVoicePlayer();
  const toast = useToast();
  const key = `v:${voice.id}`;
  const busy = st.loading === key;
  const playing = st.playing === key;
  return (
    <button
      type="button"
      className="icon-btn"
      aria-label={playing ? `Stop ${voice.name}` : `Preview ${voice.name}`}
      onClick={() => voicePlayer.preview(voice.id).catch((e) => toast(errorText(e), "error"))}
    >
      {busy ? (
        <Loader2 size={16} className="animate-spin" />
      ) : playing ? (
        <Square size={14} fill="currentColor" />
      ) : (
        <Play size={16} />
      )}
    </button>
  );
}

function CloneForm({ onCloned }: { onCloned: (v: Voice) => void }) {
  const toast = useToast();
  const [name, setName] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [rights, setRights] = useState(false);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLInputElement>(null);
  const submit = async () => {
    if (!file) return;
    setBusy(true);
    try {
      onCloned(await api.cloneVoice(file, name.trim(), rights));
      toast("Voice created", "success");
    } catch (e) {
      toast(errorText(e), "error");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="rounded-card border border-line p-4 space-y-3">
      <h3 className="font-semibold flex items-center gap-2">
        <Mic size={16} /> Clone a voice
      </h3>
      <p className="text-sm text-ink-2">
        Upload 6 to 30 seconds of one person speaking clearly, with no music or background noise.
      </p>
      <input
        ref={ref}
        type="file"
        accept="audio/*"
        className="hidden"
        onChange={(e) => setFile(e.target.files?.[0] ?? null)}
      />
      <div className="flex flex-wrap gap-2 items-center">
        <button type="button" className="btn-secondary" onClick={() => ref.current?.click()}>
          <Upload size={16} /> {file ? "Change file" : "Choose audio"}
        </button>
        {file && <span className="text-sm text-ink-2 truncate max-w-56">{file.name}</span>}
      </div>
      <div>
        <label className="label" htmlFor="clone-name">
          Voice name
        </label>
        <input
          id="clone-name"
          className="field"
          value={name}
          maxLength={64}
          onChange={(e) => setName(e.target.value)}
        />
      </div>
      <label className="flex items-start gap-2.5 text-sm cursor-pointer">
        <input
          type="checkbox"
          className="mt-1 accent-[var(--ember)]"
          checked={rights}
          onChange={(e) => setRights(e.target.checked)}
        />
        <span>
          This is my own voice, or I have the speaker's permission to clone it. I won't use it to
          impersonate anyone.
        </span>
      </label>
      <button
        type="button"
        className="btn-primary"
        disabled={!file || !name.trim() || !rights || busy}
        onClick={submit}
      >
        {busy ? "Creating…" : "Create voice"}
      </button>
    </div>
  );
}

function VoiceBrowser({
  value,
  onPick,
  onClose,
}: {
  value: string | null;
  onPick: (v: Voice | null) => void;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const caps = useCaps();
  const { data: voices, isLoading } = useQuery({ queryKey: ["voices"], queryFn: api.voices });
  const [lang, setLang] = useState("all");
  const [gender, setGender] = useState("all");
  const [q, setQ] = useState("");
  const langs = useMemo(() => [...new Set((voices ?? []).map((v) => v.language))].sort(), [voices]);
  const shown = (voices ?? []).filter(
    (v) =>
      (lang === "all" || v.language === lang) &&
      (gender === "all" || v.gender === gender) &&
      (!q || v.name.toLowerCase().includes(q.toLowerCase())),
  );
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <input
          className="field h-9 py-0 w-44"
          placeholder="Search voices"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          aria-label="Search voices"
        />
        <select
          className="field h-9 py-0 w-auto"
          value={lang}
          onChange={(e) => setLang(e.target.value)}
          aria-label="Language"
        >
          <option value="all">All languages</option>
          {langs.map((l) => (
            <option key={l} value={l}>
              {l}
            </option>
          ))}
        </select>
        <select
          className="field h-9 py-0 w-auto"
          value={gender}
          onChange={(e) => setGender(e.target.value)}
          aria-label="Voice type"
        >
          <option value="all">Any voice</option>
          <option value="female">Feminine</option>
          <option value="male">Masculine</option>
        </select>
      </div>
      {isLoading && <div className="skeleton h-40 rounded-card" />}
      <ul className="divide-y divide-line rounded-card bg-surface-2 max-h-[46dvh] overflow-y-auto scroll-thin">
        <li className="flex items-center gap-3 px-3 py-2">
          <span className="flex-1 text-sm text-ink-2">No voice (server default)</span>
          <button
            type="button"
            className={clsx("btn-ghost h-8", !value && "text-ember")}
            onClick={() => {
              onPick(null);
              onClose();
            }}
          >
            {!value ? (
              <>
                <Check size={14} /> Selected
              </>
            ) : (
              "Use"
            )}
          </button>
        </li>
        {shown.map((v) => (
          <li key={v.id} className="flex items-center gap-3 px-3 py-2">
            <PreviewButton voice={v} />
            <span className="flex-1 min-w-0">
              <span className="block text-sm font-semibold truncate">
                {v.name}
                {v.owner_id && <span className="ml-2 text-xs font-normal text-ember">yours</span>}
              </span>
              <span className="block text-xs text-ink-3">
                {[v.language, v.gender, v.description].filter(Boolean).join(" · ")}
              </span>
            </span>
            {v.owner_id && (
              <button
                type="button"
                className="icon-btn size-8"
                aria-label={`Delete ${v.name}`}
                onClick={async () => {
                  await api.deleteVoice(v.id);
                  void qc.invalidateQueries({ queryKey: ["voices"] });
                }}
              >
                <Trash2 size={14} />
              </button>
            )}
            <button
              type="button"
              className={clsx("btn-ghost h-8", value === v.id && "text-ember")}
              onClick={() => {
                onPick(v);
                onClose();
              }}
            >
              {value === v.id ? (
                <>
                  <Check size={14} /> Selected
                </>
              ) : (
                "Use"
              )}
            </button>
          </li>
        ))}
        {!isLoading && !shown.length && (
          <li className="px-3 py-4 text-sm text-ink-3">No voices match.</li>
        )}
      </ul>
      {caps.data?.voice_cloning && (
        <CloneForm
          onCloned={(v) => {
            void qc.invalidateQueries({ queryKey: ["voices"] });
            onPick(v);
            onClose();
          }}
        />
      )}
    </div>
  );
}

export function VoicePicker({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (v: string | null) => void;
}) {
  const caps = useCaps();
  const { data: voices } = useQuery({
    queryKey: ["voices"],
    queryFn: api.voices,
    enabled: !!caps.data?.tts,
  });
  const [open, setOpen] = useState(false);
  if (!caps.data?.tts) return null;
  const current = voices?.find((v) => v.id === value) ?? null;
  return (
    <div>
      <span className="label">Voice</span>
      <div className="flex items-center gap-2 rounded-control bg-surface-2 px-2 py-1.5">
        {current ? <PreviewButton voice={current} /> : <span className="size-9" />}
        <span className="flex-1 text-sm">{current ? current.name : "Server default voice"}</span>
        <button type="button" className="btn-ghost h-8" onClick={() => setOpen(true)}>
          Browse voices
        </button>
      </div>
      <Modal
        open={open}
        onClose={() => {
          voicePlayer.stop();
          setOpen(false);
        }}
        title="Voice library"
        wide
      >
        {open && (
          <VoiceBrowser
            value={value}
            onPick={(v) => onChange(v?.id ?? null)}
            onClose={() => setOpen(false)}
          />
        )}
      </Modal>
    </div>
  );
}
