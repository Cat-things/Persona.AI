import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { X } from "lucide-react";
import clsx from "clsx";

type Kind = "info" | "error" | "success";
interface Toast {
  id: number;
  kind: Kind;
  text: string;
}

const Ctx = createContext<(text: string, kind?: Kind) => void>(() => {});
let nextId = 1;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const dismiss = (id: number) => setToasts((t) => t.filter((x) => x.id !== id));
  const push = useCallback((text: string, kind: Kind = "info") => {
    const id = nextId++;
    setToasts((t) => [...t.slice(-3), { id, kind, text }]);
    setTimeout(() => dismiss(id), kind === "error" ? 7000 : 3500);
  }, []);
  return (
    <Ctx.Provider value={push}>
      {children}
      <div
        className="fixed bottom-4 left-1/2 -translate-x-1/2 z-(--z-toast) flex flex-col gap-2 w-[min(92vw,420px)] pointer-events-none"
        aria-live="polite"
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            role={t.kind === "error" ? "alert" : "status"}
            className={clsx(
              "fade-in pointer-events-auto flex items-start gap-3 rounded-xl px-4 py-3 text-sm border",
              t.kind === "error"
                ? "bg-surface border-err text-ink"
                : t.kind === "success"
                  ? "bg-surface border-ok text-ink"
                  : "bg-surface border-line text-ink",
            )}
            style={{ boxShadow: "var(--shadow)" }}
          >
            <span className="flex-1">{t.text}</span>
            <button
              className="text-ink-3 hover:text-ink"
              onClick={() => dismiss(t.id)}
              aria-label="Dismiss"
            >
              <X size={16} />
            </button>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

export const useToast = () => useContext(Ctx);

export function errorText(e: unknown): string {
  if (e && typeof e === "object" && "detail" in e) return String((e as { detail: string }).detail);
  if (e instanceof Error) return e.message;
  return "Something went wrong";
}
