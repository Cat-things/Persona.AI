import { Minus, Plus } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

const VIEW = 280;
const OUT = 512;

/** Pan/zoom an image inside a circular mask, export a square PNG of the visible area. */
export function AvatarCropper({
  src,
  onCancel,
  onDone,
  busy,
}: {
  src: string;
  onCancel: () => void;
  onDone: (blob: Blob) => void;
  busy?: boolean;
}) {
  const imgRef = useRef<HTMLImageElement | null>(null);
  const [nat, setNat] = useState<{ w: number; h: number } | null>(null);
  const [zoom, setZoom] = useState(1); // 1 = cover
  const [pos, setPos] = useState({ x: 0, y: 0 }); // offset of image center from view center (px)
  const drag = useRef<{ x: number; y: number; px: number; py: number } | null>(null);

  useEffect(() => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      imgRef.current = img;
      setNat({ w: img.naturalWidth, h: img.naturalHeight });
      setZoom(1);
      setPos({ x: 0, y: 0 });
    };
    img.src = src;
  }, [src]);

  const cover = nat ? Math.max(VIEW / nat.w, VIEW / nat.h) : 1;
  const scale = cover * zoom;
  const dispW = (nat?.w ?? VIEW) * scale;
  const dispH = (nat?.h ?? VIEW) * scale;

  const clamp = useCallback(
    (p: { x: number; y: number }, s = scale) => {
      if (!nat) return p;
      const maxX = Math.max(0, (nat.w * s - VIEW) / 2);
      const maxY = Math.max(0, (nat.h * s - VIEW) / 2);
      return { x: Math.min(maxX, Math.max(-maxX, p.x)), y: Math.min(maxY, Math.max(-maxY, p.y)) };
    },
    [nat, scale],
  );

  const setZoomClamped = (z: number) => {
    const nz = Math.min(4, Math.max(1, z));
    setZoom(nz);
    setPos((p) => clamp(p, cover * nz));
  };

  const exportCrop = () => {
    const img = imgRef.current;
    if (!img || !nat) return;
    const canvas = document.createElement("canvas");
    canvas.width = OUT;
    canvas.height = OUT;
    const ctx = canvas.getContext("2d")!;
    const k = OUT / VIEW;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(
      img,
      (VIEW / 2 + pos.x - dispW / 2) * k,
      (VIEW / 2 + pos.y - dispH / 2) * k,
      dispW * k,
      dispH * k,
    );
    canvas.toBlob((b) => b && onDone(b), "image/png");
  };

  return (
    <div className="flex flex-col items-center gap-4">
      <div
        className="relative overflow-hidden rounded-card bg-surface-2 touch-none select-none cursor-grab active:cursor-grabbing focus-visible:outline-2"
        style={{ width: VIEW, height: VIEW }}
        tabIndex={0}
        role="application"
        aria-label="Crop area. Drag or use arrow keys to move, plus and minus to zoom."
        onPointerDown={(e) => {
          (e.target as HTMLElement).setPointerCapture(e.pointerId);
          drag.current = { x: e.clientX, y: e.clientY, px: pos.x, py: pos.y };
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (!d) return;
          setPos(clamp({ x: d.px + e.clientX - d.x, y: d.py + e.clientY - d.y }));
        }}
        onPointerUp={() => (drag.current = null)}
        onWheel={(e) => setZoomClamped(zoom * (e.deltaY < 0 ? 1.08 : 1 / 1.08))}
        onKeyDown={(e) => {
          const step = 10;
          if (e.key === "ArrowLeft") setPos((p) => clamp({ ...p, x: p.x + step }));
          else if (e.key === "ArrowRight") setPos((p) => clamp({ ...p, x: p.x - step }));
          else if (e.key === "ArrowUp") setPos((p) => clamp({ ...p, y: p.y + step }));
          else if (e.key === "ArrowDown") setPos((p) => clamp({ ...p, y: p.y - step }));
          else if (e.key === "+" || e.key === "=") setZoomClamped(zoom * 1.1);
          else if (e.key === "-") setZoomClamped(zoom / 1.1);
          else return;
          e.preventDefault();
        }}
      >
        {nat && (
          <img
            src={src}
            alt=""
            draggable={false}
            className="absolute max-w-none pointer-events-none"
            style={{
              width: dispW,
              height: dispH,
              left: VIEW / 2 + pos.x - dispW / 2,
              top: VIEW / 2 + pos.y - dispH / 2,
            }}
          />
        )}
        <div
          className="pointer-events-none absolute inset-0 rounded-full"
          style={{ boxShadow: "0 0 0 9999px oklch(0.1 0.02 275 / 0.6)" }}
        />
        <div className="pointer-events-none absolute inset-0 rounded-full border-2 border-white/70" />
      </div>
      <div className="flex items-center gap-3 w-[280px]">
        <button
          type="button"
          className="icon-btn"
          onClick={() => setZoomClamped(zoom / 1.15)}
          aria-label="Zoom out"
        >
          <Minus size={16} />
        </button>
        <input
          type="range"
          min={1}
          max={4}
          step={0.01}
          value={zoom}
          onChange={(e) => setZoomClamped(Number(e.target.value))}
          className="flex-1 accent-[var(--ember)]"
          aria-label="Zoom"
        />
        <button
          type="button"
          className="icon-btn"
          onClick={() => setZoomClamped(zoom * 1.15)}
          aria-label="Zoom in"
        >
          <Plus size={16} />
        </button>
      </div>
      <div className="flex gap-2 self-end">
        <button type="button" className="btn-ghost" onClick={onCancel}>
          Back
        </button>
        <button type="button" className="btn-primary" disabled={!nat || busy} onClick={exportCrop}>
          {busy ? "Saving…" : "Use this avatar"}
        </button>
      </div>
    </div>
  );
}
