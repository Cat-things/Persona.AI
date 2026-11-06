import { Fragment, type ReactNode } from "react";

/**
 * Minimal, safe chat markup: *action* / _italic_, **bold**, `code`.
 * Produces React nodes only (never HTML strings), so model output can't inject markup.
 */
const TOKEN = /(\*\*[^*\n]+\*\*|\*[^*\n]+\*|_[^_\n]+_|`[^`\n]+`)/g;

export function renderMarkup(text: string): ReactNode {
  const parts = text.split(TOKEN);
  return parts.map((p, i) => {
    if (!p) return null;
    if (p.startsWith("**") && p.endsWith("**") && p.length > 4)
      return <strong key={i}>{p.slice(2, -2)}</strong>;
    if ((p.startsWith("*") && p.endsWith("*")) || (p.startsWith("_") && p.endsWith("_"))) {
      if (p.length > 2) return <em key={i}>{p.slice(1, -1)}</em>;
    }
    if (p.startsWith("`") && p.endsWith("`") && p.length > 2)
      return <code key={i}>{p.slice(1, -1)}</code>;
    return <Fragment key={i}>{p}</Fragment>;
  });
}
