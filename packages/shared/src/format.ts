/** Small formatting helpers shared by web and mobile. */

export function compactNumber(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0).replace(/\.0$/, "")}k`;
  return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}m`;
}

/** Stable hue for a name, used for avatar fallbacks. */
export function nameHue(name: string): number {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return h % 360;
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}

export type HistoryBucket = "Today" | "Yesterday" | "This week" | "Earlier";

export function historyBucket(iso: string, now = new Date()): HistoryBucket {
  const d = new Date(iso);
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const t = d.getTime();
  if (t >= start) return "Today";
  if (t >= start - 86_400_000) return "Yesterday";
  if (t >= start - 6 * 86_400_000) return "This week";
  return "Earlier";
}

/** Split text into sentences for chunked TTS. Keeps punctuation. */
export function splitSentences(text: string): string[] {
  const out: string[] = [];
  const re = /[^.!?…\n]+[.!?…]+["')\]]*|[^.!?…\n]+$/g;
  for (const m of text.matchAll(re)) {
    const s = m[0].trim();
    if (s) out.push(s);
  }
  return out;
}

/** Strip roleplay action markup (*waves*) for speech. */
export function speakable(text: string): string {
  return text
    .replace(/\*[^*]+\*/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
