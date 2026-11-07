import { ApiError, ChatSocket, PersonaClient, type TokenStore, type UserMe } from "@persona/shared";
import * as SecureStore from "expo-secure-store";

const REFRESH_KEY = "persona.refresh_token";

/** Native apps keep the refresh token in the OS keystore (no cookies). */
const secureStore: TokenStore = {
  async getRefresh() {
    try {
      return await SecureStore.getItemAsync(REFRESH_KEY);
    } catch {
      return null;
    }
  },
  async setRefresh(token) {
    if (token) await SecureStore.setItemAsync(REFRESH_KEY, token);
    else await SecureStore.deleteItemAsync(REFRESH_KEY);
  },
};

/**
 * Expo SDK 58 replaces global fetch with expo/fetch, which rejects React Native's
 * `{ uri, name, type }` FormData file parts. Uploads therefore go through XMLHttpRequest,
 * React Native's own networking path, which streams the file from its uri; everything
 * else keeps using the global fetch.
 */
function xhrFetch(url: string, init: RequestInit = {}): Promise<Response> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(init.method ?? "GET", url);
    const headers = new Headers(init.headers);
    headers.forEach((v, k) => xhr.setRequestHeader(k, v));
    xhr.withCredentials = init.credentials === "include";
    xhr.responseType = "text";
    xhr.onload = () => {
      const h = new Headers();
      for (const line of xhr.getAllResponseHeaders().trim().split(/[\r\n]+/)) {
        const i = line.indexOf(":");
        if (i > 0) h.append(line.slice(0, i).trim(), line.slice(i + 1).trim());
      }
      const empty = xhr.status === 204 || xhr.status === 205 || xhr.status === 304;
      resolve(new Response(empty ? null : xhr.responseText, { status: xhr.status, headers: h }));
    };
    xhr.onerror = () => reject(new TypeError("Network request failed"));
    xhr.ontimeout = () => reject(new TypeError("Network request timed out"));
    xhr.send(init.body as XMLHttpRequestBodyInit | null | undefined);
  });
}

const fetchImpl: typeof fetch = (input, init) =>
  init?.body instanceof FormData ? xhrFetch(String(input), init) : fetch(input, init);

let userListener: ((u: UserMe | null) => void) | null = null;

/** The client is replaced when the user switches servers; always read `api` at call time. */
export let api = new PersonaClient({ baseUrl: "", store: secureStore, fetchImpl });
export let chatSocket = new ChatSocket(api);

export function connect(baseUrl: string) {
  chatSocket.close();
  api = new PersonaClient({
    baseUrl,
    store: secureStore,
    fetchImpl,
    onUserChange: (u) => userListener?.(u),
  });
  chatSocket = new ChatSocket(api);
}

export function onUserChange(fn: (u: UserMe | null) => void) {
  userListener = fn;
  api.onUserChange = fn;
}

export async function forgetSession() {
  await secureStore.setRefresh(null);
}

export function errorText(e: unknown): string {
  if (e instanceof ApiError) return e.detail;
  if (e instanceof Error) {
    if (/network request failed/i.test(e.message)) return "Can't reach the server.";
    return e.message;
  }
  return "Something went wrong";
}

/** Absolute URL for "/media/..." paths. */
export function media(path: string | null | undefined): string | undefined {
  return api.mediaUrl(path);
}
