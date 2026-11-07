import type { InstanceConfig } from "@persona/shared";
import * as SecureStore from "expo-secure-store";

const KEY = "persona.server_url";

export async function savedServer(): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(KEY);
  } catch {
    return null;
  }
}

export async function saveServer(url: string | null) {
  if (url) await SecureStore.setItemAsync(KEY, url);
  else await SecureStore.deleteItemAsync(KEY);
}

/** True for addresses that never leave the device or home network. */
export function isLocalAddress(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    return (
      host === "localhost" ||
      host.endsWith(".local") ||
      /^127\./.test(host) ||
      /^10\./.test(host) ||
      /^192\.168\./.test(host) ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
      /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(host) // Tailscale / CGNAT
    );
  } catch {
    return false;
  }
}

export type CheckResult =
  { ok: true; url: string; config: InstanceConfig } | { ok: false; error: string };

async function fetchJson(url: string, ms: number): Promise<unknown> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { Accept: "application/json" } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

/**
 * Normalise what the user typed and prove it's a Persona.AI server: `/api/v1/auth/config`
 * must answer with `app: "persona"`. Without a scheme, HTTPS is tried first.
 */
export async function checkServer(input: string): Promise<CheckResult> {
  let raw = input.trim().replace(/\/+$/, "");
  if (!raw) return { ok: false, error: "Enter your server's address." };
  raw = raw.replace(/\/api(\/v1)?$/, "");
  const candidates = /^https?:\/\//i.test(raw) ? [raw] : [`https://${raw}`, `http://${raw}`];
  let lastError = "";
  for (const base of candidates) {
    try {
      new URL(base);
    } catch {
      return { ok: false, error: "That doesn't look like a web address." };
    }
    try {
      const cfg = (await fetchJson(`${base}/api/v1/auth/config`, 8000)) as Partial<InstanceConfig>;
      if (cfg?.app !== "persona") {
        lastError = "Something answered, but it isn't a Persona.AI server.";
        continue;
      }
      return { ok: true, url: base, config: cfg as InstanceConfig };
    } catch (e) {
      lastError =
        e instanceof Error && e.name === "AbortError"
          ? "The server didn't answer in time."
          : "Couldn't reach that address. Check it, and that your phone can reach the server.";
    }
  }
  return { ok: false, error: lastError };
}
