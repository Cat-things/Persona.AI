import { initials, nameHue } from "@persona/shared";
import clsx from "clsx";
import { useState } from "react";
import { media } from "../lib/api";

export function Avatar({
  src,
  name,
  size = 40,
  className,
  ring,
}: {
  src?: string | null;
  name: string;
  size?: number;
  className?: string;
  ring?: boolean;
}) {
  const [broken, setBroken] = useState(false);
  const url = media(src);
  const style = { width: size, height: size, fontSize: Math.max(11, size * 0.38) };
  const cls = clsx(
    "shrink-0 rounded-full overflow-hidden select-none",
    ring && "ring-2 ring-bg",
    className,
  );
  if (url && !broken) {
    return (
      <img
        src={url}
        alt=""
        width={size}
        height={size}
        loading="lazy"
        onError={() => setBroken(true)}
        className={clsx(cls, "object-cover bg-surface-2")}
        style={style}
      />
    );
  }
  const h = nameHue(name || "?");
  return (
    <span
      aria-hidden="true"
      className={clsx(cls, "inline-flex items-center justify-center font-bold")}
      style={{
        ...style,
        background: `oklch(0.42 0.09 ${h})`,
        color: `oklch(0.93 0.04 ${h})`,
      }}
    >
      {initials(name)}
    </span>
  );
}
