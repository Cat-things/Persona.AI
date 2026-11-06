import clsx from "clsx";
import { ArrowUp, Phone, Square } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";

export function Composer({
  placeholder,
  busy,
  disabled,
  onSend,
  onStop,
  onCall,
  micSlot,
  draftKey,
}: {
  placeholder: string;
  busy: boolean;
  disabled?: boolean;
  onSend: (text: string) => void;
  onStop: () => void;
  onCall?: () => void;
  micSlot?: (append: (text: string) => void) => ReactNode;
  draftKey: string;
}) {
  const [text, setText] = useState(() => {
    try {
      return sessionStorage.getItem(draftKey) ?? "";
    } catch {
      return "";
    }
  });
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    try {
      if (text) sessionStorage.setItem(draftKey, text);
      else sessionStorage.removeItem(draftKey);
    } catch {
      /* ignore */
    }
  }, [text, draftKey]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [text]);

  // Desktop: focus the composer when the chat opens.
  useEffect(() => {
    if (matchMedia("(pointer: fine)").matches) ref.current?.focus();
  }, [draftKey]);

  const submit = () => {
    if (!text.trim() || busy || disabled) return;
    onSend(text);
    setText("");
  };

  return (
    <div className="flex items-end gap-2 rounded-[26px] bg-surface border border-line p-1.5 pl-4 focus-within:border-ink-3 transition-colors">
      <label htmlFor="composer" className="sr-only">
        Message
      </label>
      <textarea
        id="composer"
        ref={ref}
        rows={1}
        value={text}
        placeholder={placeholder}
        disabled={disabled}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (
            e.key === "Enter" &&
            !e.shiftKey &&
            !e.nativeEvent.isComposing &&
            matchMedia("(pointer: fine)").matches
          ) {
            e.preventDefault();
            submit();
          }
        }}
        enterKeyHint="send"
        className="flex-1 resize-none bg-transparent py-2 text-ink placeholder:text-ink-3 focus:outline-none max-h-[200px] scroll-thin leading-6"
      />
      {micSlot?.((t) => setText((cur) => (cur.trim() ? `${cur.trimEnd()} ${t}` : t)))}
      {onCall && (
        <button
          className="icon-btn size-10"
          onClick={onCall}
          aria-label="Start a voice call"
          title="Call"
        >
          <Phone size={18} />
        </button>
      )}
      {busy ? (
        <button
          className="inline-flex size-10 items-center justify-center rounded-full bg-ink text-bg"
          onClick={onStop}
          aria-label="Stop generating"
        >
          <Square size={14} fill="currentColor" />
        </button>
      ) : (
        <button
          className={clsx(
            "inline-flex size-10 items-center justify-center rounded-full transition-colors duration-150",
            text.trim()
              ? "bg-ember text-ember-ink hover:bg-ember-hover"
              : "bg-surface-2 text-ink-3",
          )}
          onClick={submit}
          disabled={!text.trim() || disabled}
          aria-label="Send message"
        >
          <ArrowUp size={19} strokeWidth={2.5} />
        </button>
      )}
    </div>
  );
}
