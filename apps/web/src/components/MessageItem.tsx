import { messageText, type Message } from "@persona/shared";
import clsx from "clsx";
import {
  ChevronLeft,
  ChevronRight,
  Copy,
  Flag,
  MoreHorizontal,
  Pencil,
  Pin,
  PinOff,
  RotateCcw,
  Star,
  Trash2,
} from "lucide-react";
import { memo, useEffect, useRef, useState, type ReactNode } from "react";
import { renderMarkup } from "../lib/markup";
import { Avatar } from "./Avatar";
import { Popover } from "./Popover";

export interface Speaker {
  name: string;
  avatar: string | null;
}

export function StarRating({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const [hover, setHover] = useState(0);
  const shown = hover || value;
  return (
    <div
      className="inline-flex items-center"
      role="radiogroup"
      aria-label="Rate this reply"
      onMouseLeave={() => setHover(0)}
    >
      {[1, 2, 3, 4].map((n) => (
        <button
          key={n}
          role="radio"
          aria-checked={value === n}
          aria-label={`${n} star${n > 1 ? "s" : ""}`}
          className="p-1 rounded-full text-ink-3 hover:text-star transition-colors"
          onMouseEnter={() => setHover(n)}
          onClick={() => onChange(value === n ? 0 : n)}
        >
          <Star
            size={16}
            className={clsx(
              "transition-transform duration-150",
              n <= shown && "text-star scale-110",
            )}
            fill={n <= shown ? "currentColor" : "none"}
          />
        </button>
      ))}
    </div>
  );
}

function EditBox({
  initial,
  onSave,
  onCancel,
}: {
  initial: string;
  onSave: (s: string) => void;
  onCancel: () => void;
}) {
  const [v, setV] = useState(initial);
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, []);
  useEffect(() => {
    const el = ref.current;
    if (el) {
      el.style.height = "auto";
      el.style.height = `${Math.min(el.scrollHeight, 420)}px`;
    }
  }, [v]);
  return (
    <div className="w-full">
      <label className="sr-only" htmlFor="edit-message">
        Edit message
      </label>
      <textarea
        id="edit-message"
        ref={ref}
        value={v}
        onChange={(e) => setV(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") onCancel();
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) onSave(v);
        }}
        className="field chat-text resize-none min-h-24"
      />
      <div className="flex justify-end gap-2 mt-2">
        <button className="btn-ghost h-8" onClick={onCancel}>
          Cancel
        </button>
        <button className="btn-primary h-8" disabled={!v.trim()} onClick={() => onSave(v)}>
          Save
        </button>
      </div>
    </div>
  );
}

interface Props {
  m: Message;
  speaker: Speaker;
  isLast: boolean;
  streaming: boolean;
  busy: boolean;
  onSwipe: (m: Message, dir: -1 | 1) => void;
  onRate: (m: Message, r: number) => void;
  onEdit: (m: Message, text: string) => void;
  onDelete: (m: Message) => void;
  onRewind: (m: Message) => void;
  onPin: (m: Message) => void;
  onReport?: (m: Message) => void;
  extraActions?: ReactNode;
}

export const MessageItem = memo(function MessageItem({
  m,
  speaker,
  isLast,
  streaming,
  busy,
  onSwipe,
  onRate,
  onEdit,
  onDelete,
  onRewind,
  onPin,
  onReport,
  extraActions,
}: Props) {
  const [editing, setEditing] = useState(false);
  const [dir, setDir] = useState<0 | -1 | 1>(0);
  const isUser = m.role === "user";
  const text = messageText(m);
  const idx = Math.max(
    0,
    m.candidates.findIndex((c) => c.id === m.selected_candidate_id),
  );
  const total = m.candidates.length;
  const sel = m.candidates[idx];
  const canSwipe = !isUser && isLast && !m.id.startsWith("tmp-");
  const empty = streaming && !text;

  const swipe = (d: -1 | 1) => {
    setDir(d);
    onSwipe(m, d);
  };

  const menu = (
    <Popover
      label="Message actions"
      trigger={(p) => (
        <button {...p} className="icon-btn size-8" disabled={m.id.startsWith("tmp-")}>
          <MoreHorizontal size={16} />
        </button>
      )}
    >
      {(close) => (
        <>
          <button
            className="menu-item"
            onClick={() => {
              void navigator.clipboard?.writeText(text);
              close();
            }}
          >
            <Copy size={15} /> Copy text
          </button>
          <button
            className="menu-item"
            disabled={busy}
            onClick={() => {
              setEditing(true);
              close();
            }}
          >
            <Pencil size={15} /> Edit
          </button>
          <button
            className="menu-item"
            onClick={() => {
              onPin(m);
              close();
            }}
          >
            {m.is_pinned ? <PinOff size={15} /> : <Pin size={15} />}
            {m.is_pinned ? "Unpin from memory" : "Pin to memory"}
          </button>
          <button
            className="menu-item"
            disabled={busy}
            onClick={() => {
              onRewind(m);
              close();
            }}
          >
            <RotateCcw size={15} /> Rewind to here
          </button>
          {!isUser && onReport && (
            <button
              className="menu-item"
              onClick={() => {
                onReport(m);
                close();
              }}
            >
              <Flag size={15} /> Report reply
            </button>
          )}
          <div className="my-1 border-t border-line" />
          <button
            className="menu-item text-err"
            disabled={busy}
            onClick={() => {
              onDelete(m);
              close();
            }}
          >
            <Trash2 size={15} /> Delete message
          </button>
        </>
      )}
    </Popover>
  );

  const reveal =
    "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity";

  if (isUser) {
    return (
      <div className="group flex justify-end items-center gap-1.5 fade-in" tabIndex={-1}>
        {!editing && <div className={clsx("flex items-center gap-1", reveal)}>{menu}</div>}
        <div
          className={clsx(
            "flex flex-col items-end",
            editing ? "w-full max-w-[85%] sm:max-w-[75%]" : "max-w-[85%] sm:max-w-[75%]",
          )}
        >
          {editing ? (
            <EditBox
              initial={text}
              onCancel={() => setEditing(false)}
              onSave={(v) => {
                onEdit(m, v);
                setEditing(false);
              }}
            />
          ) : (
            <div className="relative rounded-bubble rounded-br-md bg-user-bubble px-4 py-2.5 chat-text">
              {renderMarkup(text)}
              {m.is_pinned && (
                <Pin size={12} className="absolute -left-1 -top-1 text-ember" aria-label="Pinned" />
              )}
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div
      className="group flex gap-3 fade-in"
      tabIndex={canSwipe ? 0 : -1}
      onKeyDown={(e) => {
        if (!canSwipe || editing || e.target !== e.currentTarget) return;
        if (e.key === "ArrowLeft") swipe(-1);
        if (e.key === "ArrowRight" && !busy) swipe(1);
      }}
      aria-label={
        canSwipe
          ? `${speaker.name}'s reply. Use left and right arrows to swipe between alternatives.`
          : undefined
      }
    >
      <Avatar src={speaker.avatar} name={speaker.name} size={36} className="mt-0.5" />
      <div className="min-w-0 flex-1 max-w-[min(100%,70ch)]">
        <div className="flex items-center gap-2 mb-1 h-6">
          <span className="text-sm font-semibold">{speaker.name}</span>
          {m.is_pinned && <Pin size={13} className="text-ember" aria-label="Pinned to memory" />}
          {!isLast && !editing && !streaming && (
            <span className={clsx("ml-auto", reveal)}>{menu}</span>
          )}
        </div>
        {editing ? (
          <EditBox
            initial={text}
            onCancel={() => setEditing(false)}
            onSave={(v) => {
              onEdit(m, v);
              setEditing(false);
            }}
          />
        ) : empty ? (
          <TypingDots />
        ) : (
          <div
            key={sel?.id}
            className={clsx(
              "rounded-bubble rounded-tl-md bg-surface px-4 py-2.5 chat-text inline-block max-w-full",
              streaming && "caret",
              !streaming && dir === -1 && "swipe-in-left",
              !streaming && dir === 1 && "swipe-in-right",
            )}
          >
            {renderMarkup(text)}
          </div>
        )}
        {!editing && !empty && (isLast || extraActions) && (
          <div className="flex items-center gap-1 mt-1 min-h-8">
            {canSwipe && (
              <div className="inline-flex items-center">
                <button
                  className="icon-btn size-8"
                  aria-label="Previous reply"
                  disabled={idx === 0 || streaming}
                  onClick={() => swipe(-1)}
                >
                  <ChevronLeft size={18} />
                </button>
                <span
                  className="text-xs text-ink-3 tabular-nums min-w-8 text-center"
                  aria-live="polite"
                >
                  {idx + 1}/{total}
                </span>
                <button
                  className="icon-btn size-8"
                  aria-label={idx === total - 1 ? "Generate a new reply" : "Next reply"}
                  disabled={streaming || (busy && idx === total - 1)}
                  onClick={() => swipe(1)}
                >
                  <ChevronRight size={18} />
                </button>
              </div>
            )}
            {!isUser && isLast && !streaming && sel && !m.id.startsWith("tmp-") && (
              <StarRating value={sel.rating} onChange={(r) => onRate(m, r)} />
            )}
            {extraActions}
            <span className="ml-auto" />
            {isLast && !streaming && menu}
          </div>
        )}
      </div>
    </div>
  );
});

export function TypingDots({ label }: { label?: string }) {
  return (
    <div
      className="inline-flex items-center gap-1 rounded-bubble rounded-tl-md bg-surface px-4 py-3.5"
      role="status"
      aria-label={label ?? "Typing"}
    >
      <span className="typing-dot size-1.5 rounded-full bg-ink-2" />
      <span className="typing-dot size-1.5 rounded-full bg-ink-2" />
      <span className="typing-dot size-1.5 rounded-full bg-ink-2" />
    </div>
  );
}
