import type { RefusalNotice } from "@persona/shared";
import { Hand, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

interface Props {
  refusal: { notice: RefusalNotice; name: string } | null;
  onClose: () => void;
}

/**
 * Escalating response when the model keeps refusing: a small banner for the first couple
 * of refusals, then a full-screen popup whose button stays locked for longer each time.
 */
export function RefusalWarning({ refusal, onClose }: Props) {
  if (!refusal) return null;
  const name = refusal.name || "The character";
  if (refusal.notice.level === "stop")
    return <StopDialog key={refusal.notice.count} {...refusal} name={name} onClose={onClose} />;
  return (
    <div
      role="status"
      className="mx-auto mt-2 w-[min(100%-1.5rem,48rem)] flex items-start gap-3 rounded-control border border-warn/40 bg-warn/10 px-3 py-2 fade-in"
    >
      <Hand size={18} className="mt-0.5 shrink-0 text-warn" aria-hidden="true" />
      <p className="flex-1 text-sm text-ink">
        {refusal.notice.count > 1
          ? `${name} has said no ${refusal.notice.count} times now. Please ease off and take the story somewhere else.`
          : `${name} won't go there. Take a breath and steer the story in a different direction.`}
      </p>
      <button className="icon-btn size-7 -mr-1" aria-label="Dismiss" onClick={onClose}>
        <X size={16} />
      </button>
    </div>
  );
}

function StopDialog({
  notice,
  name,
  onClose,
}: {
  notice: RefusalNotice;
  name: string;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [left, setLeft] = useState(notice.hold_seconds);

  useEffect(() => {
    ref.current?.showModal();
  }, []);
  useEffect(() => {
    if (left <= 0) return;
    const t = setTimeout(() => setLeft((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [left]);

  return (
    <dialog
      ref={ref}
      // Escape must not skip the countdown.
      onCancel={(e) => e.preventDefault()}
      aria-labelledby="refusal-title"
      className="m-auto w-[min(92vw,460px)] rounded-2xl border border-err/50 bg-surface p-0 text-ink backdrop:bg-black/75 open:fade-in"
      style={{ boxShadow: "var(--shadow)" }}
    >
      <div className="flex flex-col items-center gap-4 px-6 py-8 text-center">
        <span className="grid size-16 place-items-center rounded-full bg-err/15">
          <Hand size={32} className="text-err" aria-hidden="true" />
        </span>
        <h2 id="refusal-title" className="text-2xl font-extrabold">
          Please stop here
        </h2>
        <p className="text-ink-2">
          {name} has refused {notice.count} times in the last half hour. Pushing again won&apos;t
          change the answer, and the characters on this server won&apos;t go there.
        </p>
        <p className="text-ink-2">Take a break, or start the story somewhere new.</p>
        <button
          className="btn-primary w-full mt-2"
          disabled={left > 0}
          onClick={() => {
            ref.current?.close();
            onClose();
          }}
        >
          {left > 0 ? `I understand (${left})` : "I understand"}
        </button>
      </div>
    </dialog>
  );
}
