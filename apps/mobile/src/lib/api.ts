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

let userListener: ((u: UserMe | null) => void) | null = null;

/** The client is replaced when the user switches servers; always read `api` at call time. */
export let api = new PersonaClient({ baseUrl: "", store: secureStore });
export let chatSocket = new ChatSocket(api);

export function connect(baseUrl: string) {
  chatSocket.close();
  api = new PersonaClient({
    baseUrl,
    store: secureStore,
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
