import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

/** Menu anchored to a trigger, rendered in a portal with fixed positioning (never clipped). */
export function Popover({
  trigger,
  children,
  align = "end",
  side = "bottom",
  label,
}: {
  trigger: (props: {
    onClick: () => void;
    "aria-expanded": boolean;
    "aria-haspopup": "menu";
    "aria-label"?: string;
  }) => ReactNode;
  children: (close: () => void) => ReactNode;
  align?: "start" | "end";
  side?: "bottom" | "top";
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLSpanElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  useLayoutEffect(() => {
    if (!open || !anchor.current || !panel.current) return;
    const a = anchor.current.getBoundingClientRect();
    const p = panel.current.getBoundingClientRect();
    let top = side === "bottom" ? a.bottom + 6 : a.top - p.height - 6;
    if (top + p.height > innerHeight - 8) top = a.top - p.height - 6;
    if (top < 8) top = 8;
    let left = align === "end" ? a.right - p.width : a.left;
    left = Math.min(Math.max(8, left), innerWidth - p.width - 8);
    setPos({ top, left });
  }, [open, align, side]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!panel.current?.contains(e.target as Node) && !anchor.current?.contains(e.target as Node))
        setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    const onScroll = () => setOpen(false);
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", onScroll);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onScroll);
    };
  }, [open]);

  const close = () => setOpen(false);
  return (
    <>
      <span ref={anchor} className="inline-flex">
        {trigger({
          onClick: () => setOpen((o) => !o),
          "aria-expanded": open,
          "aria-haspopup": "menu",
          "aria-label": label,
        })}
      </span>
      {open &&
        createPortal(
          <div
            ref={panel}
            role="menu"
            className="menu fixed z-(--z-menu) fade-in"
            style={{ top: pos?.top ?? -9999, left: pos?.left ?? -9999 }}
          >
            {children(close)}
          </div>,
          document.body,
        )}
    </>
  );
}
