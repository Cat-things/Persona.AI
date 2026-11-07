import type {
  Character,
  CharacterCard,
  CharacterInput,
  Chat,
  ChatDetail,
  ChatEvent,
  ChatListItem,
  InstanceConfig,
  Job,
  Memory,
  Message,
  ModelOption,
  Notification,
  Page,
  Persona,
  Report,
  Room,
  RoomInput,
  TokenOut,
  UserMe,
  UserPublic,
  Voice,
} from "./types";

export class ApiError extends Error {
  constructor(
    public status: number,
    public detail: string,
    public body?: unknown,
  ) {
    super(detail);
  }
}

/** Where the refresh token lives. Web uses the httpOnly cookie (store returns null). */
export interface TokenStore {
  getRefresh(): Promise<string | null>;
  setRefresh(token: string | null): Promise<void>;
}

export const cookieTokenStore: TokenStore = {
  async getRefresh() {
    return null;
  },
  async setRefresh() {},
};

export type UploadFile = Blob | { uri: string; name: string; type: string };

export interface ClientOptions {
  baseUrl: string; // "" for same origin
  store?: TokenStore;
  onUserChange?: (user: UserMe | null) => void;
  fetchImpl?: typeof fetch;
}

export class PersonaClient {
  baseUrl: string;
  private access: string | null = null;
  private refreshing: Promise<boolean> | null = null;
  private store: TokenStore;
  private fetchImpl: typeof fetch;
  onUserChange?: (user: UserMe | null) => void;

  constructor(opts: ClientOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, "");
    this.store = opts.store ?? cookieTokenStore;
    this.onUserChange = opts.onUserChange;
    this.fetchImpl = opts.fetchImpl ?? ((...a) => fetch(...a));
  }

  get isAuthenticated() {
    return this.access !== null;
  }

  /** Seconds until the access token expires (0 if none or unreadable). */
  private accessTtl(): number {
    if (!this.access) return 0;
    try {
      const part = this.access.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
      const payload = JSON.parse(atob(part.padEnd(Math.ceil(part.length / 4) * 4, "="))) as {
        exp?: number;
      };
      return payload.exp ? payload.exp - Date.now() / 1000 : 0;
    } catch {
      return 0;
    }
  }

  /**
   * Authorization header with a token valid for at least a minute, for native players and
   * uploads that can't go through request() (e.g. streaming audio from a URL).
   */
  async authHeaders(): Promise<Record<string, string>> {
    if (this.accessTtl() < 60) await this.refresh();
    return this.access ? { Authorization: `Bearer ${this.access}` } : {};
  }

  url(path: string) {
    return `${this.baseUrl}/api/v1${path}`;
  }

  /** Absolute URL for media paths returned by the API ("/media/..."). */
  mediaUrl(path: string | null | undefined): string | undefined {
    if (!path) return undefined;
    if (/^(https?:|data:|blob:)/.test(path)) return path;
    return `${this.baseUrl}${path}`;
  }

  private async raw(method: string, path: string, body?: unknown, auth = true): Promise<Response> {
    const headers: Record<string, string> = {};
    let payload: BodyInit | undefined;
    if (body instanceof FormData) payload = body;
    else if (body !== undefined) {
      headers["Content-Type"] = "application/json";
      payload = JSON.stringify(body);
    }
    if (auth && this.access) headers.Authorization = `Bearer ${this.access}`;
    return this.fetchImpl(this.url(path), {
      method,
      headers,
      body: payload,
      credentials: "include",
    });
  }

  async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    let res = await this.raw(method, path, body);
    if (res.status === 401 && !path.startsWith("/auth/")) {
      if (await this.refresh()) res = await this.raw(method, path, body);
    }
    return this.parse<T>(res);
  }

  /** Authenticated binary download (e.g. PNG character cards). */
  async blob(path: string): Promise<Blob> {
    let res = await this.raw("GET", path);
    if (res.status === 401 && (await this.refresh())) res = await this.raw("GET", path);
    if (!res.ok) {
      const text = await res.text();
      throw new ApiError(res.status, errorDetail(safeJson(text)) ?? res.statusText, undefined);
    }
    return res.blob();
  }

  private async parse<T>(res: Response): Promise<T> {
    if (res.status === 204) return undefined as T;
    const text = await res.text();
    const data = text ? safeJson(text) : undefined;
    if (!res.ok) {
      throw new ApiError(res.status, errorDetail(data) ?? res.statusText, data);
    }
    return data as T;
  }

  // ---------- auth ----------
  private async accept(t: TokenOut): Promise<UserMe> {
    this.access = t.access_token;
    await this.store.setRefresh(t.refresh_token);
    this.onUserChange?.(t.user);
    return t.user;
  }

  async config(): Promise<InstanceConfig> {
    return this.parse(await this.raw("GET", "/auth/config", undefined, false));
  }

  async register(
    username: string,
    password: string,
    extra: { email?: string; invite_code?: string } = {},
  ) {
    const t = await this.parse<TokenOut>(
      await this.raw("POST", "/auth/register", { username, password, ...extra }, false),
    );
    return this.accept(t);
  }

  async login(username: string, password: string) {
    const t = await this.parse<TokenOut>(
      await this.raw("POST", "/auth/login", { username, password }, false),
    );
    return this.accept(t);
  }

  /** Try to restore a session. Returns the user or null. */
  async restore(): Promise<UserMe | null> {
    if (await this.refresh()) {
      try {
        return await this.request<UserMe>("GET", "/me");
      } catch {
        return null;
      }
    }
    return null;
  }

  refresh(): Promise<boolean> {
    if (!this.refreshing) {
      this.refreshing = (async () => {
        try {
          const stored = await this.store.getRefresh();
          const res = await this.raw(
            "POST",
            "/auth/refresh",
            stored ? { refresh_token: stored } : {},
            false,
          );
          if (!res.ok) {
            this.access = null;
            if (res.status === 401) {
              await this.store.setRefresh(null);
              this.onUserChange?.(null);
            }
            return false;
          }
          const t = (await res.json()) as TokenOut;
          this.access = t.access_token;
          await this.store.setRefresh(t.refresh_token);
          return true;
        } catch {
          return false;
        } finally {
          setTimeout(() => (this.refreshing = null), 0);
        }
      })();
    }
    return this.refreshing;
  }

  async logout() {
    const stored = await this.store.getRefresh();
    try {
      await this.raw("POST", "/auth/logout", stored ? { refresh_token: stored } : {}, false);
    } finally {
      this.access = null;
      await this.store.setRefresh(null);
      this.onUserChange?.(null);
    }
  }

  async wsToken(): Promise<string> {
    const r = await this.request<{ token: string }>("POST", "/auth/ws-token");
    return r.token;
  }

  wsUrl(path: string, token: string): string {
    let base = this.baseUrl;
    if (!base && typeof location !== "undefined") base = location.origin;
    return `${base.replace(/^http/, "ws")}/api/v1${path}?token=${encodeURIComponent(token)}`;
  }

  // ---------- me / users ----------
  me = () => this.request<UserMe>("GET", "/me");
  updateMe = (
    body: Partial<Pick<UserMe, "display_name" | "bio" | "avatar_url" | "email" | "preferences">>,
  ) => this.request<UserMe>("PATCH", "/me", body);
  changePassword = (current_password: string, new_password: string) =>
    this.request<void>("POST", "/me/password", { current_password, new_password });
  profile = (username: string) =>
    this.request<{ user: UserPublic; characters: CharacterCard[]; total_interactions: number }>(
      "GET",
      `/users/${encodeURIComponent(username)}`,
    );
  notifications = () => this.request<Notification[]>("GET", "/me/notifications");
  markNotificationsRead = () => this.request<void>("POST", "/me/notifications/read");
  registerPushToken = (token: string, platform: string) =>
    this.request<void>("POST", "/me/push-tokens", { token, platform });

  async upload(path: string, file: UploadFile, fields: Record<string, string> = {}) {
    const fd = new FormData();
    // React Native accepts {uri,name,type}; browsers take Blob/File.
    fd.append("file", file as Blob);
    for (const [k, v] of Object.entries(fields)) fd.append(k, v);
    return this.request<{ url: string } & Record<string, unknown>>("POST", path, fd);
  }
  uploadImage = (file: UploadFile) => this.upload("/media/images", file);

  // ---------- characters ----------
  discover = (
    params: {
      sort?: "trending" | "popular" | "recent" | "featured";
      q?: string;
      tag?: string;
      cursor?: string;
      limit?: number;
    } = {},
  ) => this.request<Page<CharacterCard>>("GET", `/characters${qs(params)}`);
  tags = () => this.request<{ tag: string; count: number }[]>("GET", "/characters/tags");
  myCharacters = () => this.request<CharacterCard[]>("GET", "/characters/mine");
  likedCharacters = () => this.request<CharacterCard[]>("GET", "/characters/liked");
  character = (id: string) => this.request<Character>("GET", `/characters/${id}`);
  createCharacter = (body: CharacterInput) => this.request<Character>("POST", "/characters", body);
  updateCharacter = (id: string, body: Partial<CharacterInput>) =>
    this.request<Character>("PATCH", `/characters/${id}`, body);
  deleteCharacter = (id: string) => this.request<void>("DELETE", `/characters/${id}`);
  like = (id: string) => this.request<Character>("POST", `/characters/${id}/like`);
  unlike = (id: string) => this.request<Character>("DELETE", `/characters/${id}/like`);
  characterChats = (id: string) => this.request<ChatListItem[]>("GET", `/characters/${id}/chats`);
  exportCard = (id: string) =>
    this.request<Record<string, unknown>>("GET", `/characters/${id}/card`);
  exportCardPngUrl = (id: string) => this.url(`/characters/${id}/card.png`);
  exportCardPng = (id: string) => this.blob(`/characters/${id}/card.png`);
  importCard = (file: UploadFile) =>
    this.upload("/characters/import", file) as Promise<unknown> as Promise<Character>;
  models = () => this.request<ModelOption[]>("GET", "/models");

  // ---------- chats ----------
  chats = () => this.request<ChatListItem[]>("GET", "/chats");
  createChat = (body: { character_id?: string; room_id?: string; persona_id?: string | null }) =>
    this.request<Chat>("POST", "/chats", body);
  chat = (id: string, before?: number) =>
    this.request<ChatDetail>("GET", `/chats/${id}${qs({ before })}`);
  updateChat = (id: string, body: { title?: string; persona_id?: string | null }) =>
    this.request<Chat>("PATCH", `/chats/${id}`, body);
  deleteChat = (id: string) => this.request<void>("DELETE", `/chats/${id}`);
  editMessage = (id: string, content: string) =>
    this.request<Message>("PATCH", `/messages/${id}`, { content });
  deleteMessage = (id: string, andAfter = false) =>
    this.request<void>("DELETE", `/messages/${id}${andAfter ? "?and_after=true" : ""}`);
  selectCandidate = (messageId: string, candidateId: string) =>
    this.request<Message>("POST", `/messages/${messageId}/select`, { candidate_id: candidateId });
  rate = (candidateId: string, rating: number) =>
    this.request<Message>("POST", `/candidates/${candidateId}/rate`, { rating });
  pin = (messageId: string) => this.request<Memory>("POST", `/messages/${messageId}/pin`);
  unpin = (messageId: string) => this.request<void>("DELETE", `/messages/${messageId}/pin`);
  memories = (chatId: string) => this.request<Memory[]>("GET", `/chats/${chatId}/memories`);
  addMemory = (chatId: string, content: string) =>
    this.request<Memory>("POST", `/chats/${chatId}/memories`, { content });
  editMemory = (id: string, content: string) =>
    this.request<Memory>("PATCH", `/memories/${id}`, { content });
  deleteMemory = (id: string) => this.request<void>("DELETE", `/memories/${id}`);

  // ---------- personas & rooms ----------
  personas = () => this.request<Persona[]>("GET", "/personas");
  createPersona = (body: Omit<Persona, "id">) => this.request<Persona>("POST", "/personas", body);
  updatePersona = (id: string, body: Partial<Omit<Persona, "id">>) =>
    this.request<Persona>("PATCH", `/personas/${id}`, body);
  deletePersona = (id: string) => this.request<void>("DELETE", `/personas/${id}`);
  rooms = () => this.request<Room[]>("GET", "/rooms");
  room = (id: string) => this.request<Room>("GET", `/rooms/${id}`);
  createRoom = (body: RoomInput) =>
    this.request<Room & { chat_id: string }>("POST", "/rooms", body);
  updateRoom = (id: string, body: Partial<RoomInput>) =>
    this.request<Room>("PATCH", `/rooms/${id}`, body);
  deleteRoom = (id: string) => this.request<void>("DELETE", `/rooms/${id}`);

  // ---------- voices / images / jobs ----------
  voices = () => this.request<Voice[]>("GET", "/voices");
  ttsUrl = (messageId: string) => this.url(`/messages/${messageId}/tts`);
  voicePreviewUrl = (voiceId: string) => this.url(`/voices/${voiceId}/preview`);
  async tts(messageId: string): Promise<Blob> {
    let res = await this.raw("POST", `/messages/${messageId}/tts`);
    if (res.status === 401 && (await this.refresh()))
      res = await this.raw("POST", `/messages/${messageId}/tts`);
    if (!res.ok)
      throw new ApiError(res.status, errorDetail(safeJson(await res.text())) ?? "TTS failed");
    return res.blob();
  }
  async previewVoice(voiceId: string, text?: string): Promise<Blob> {
    let res = await this.raw("POST", `/voices/${voiceId}/preview`, { text });
    if (res.status === 401 && (await this.refresh()))
      res = await this.raw("POST", `/voices/${voiceId}/preview`, { text });
    if (!res.ok)
      throw new ApiError(res.status, errorDetail(safeJson(await res.text())) ?? "Preview failed");
    return res.blob();
  }
  cloneVoice = (file: UploadFile, name: string, rightsConfirmed: boolean) =>
    this.upload("/voices/clone", file, {
      name,
      rights_confirmed: String(rightsConfirmed),
    }) as Promise<unknown> as Promise<Voice>;
  deleteVoice = (id: string) => this.request<void>("DELETE", `/voices/${id}`);
  generateAvatars = (body: {
    prompt: string;
    style?: string;
    negative?: string;
    character_id?: string;
  }) => this.request<Job>("POST", "/images/avatars", body);
  imageStyles = () => this.request<{ id: string; label: string }[]>("GET", "/images/styles");
  imageStatus = () =>
    this.request<{ configured: boolean; provider: string }>("GET", "/images/status");
  job = (id: string) => this.request<Job>("GET", `/jobs/${id}`);
  async transcribe(file: UploadFile): Promise<{ text: string }> {
    return this.upload("/stt", file) as Promise<unknown> as Promise<{ text: string }>;
  }
  capabilities = () =>
    this.request<{
      tts: boolean;
      stt: boolean;
      image: boolean;
      calls: boolean;
      voice_cloning: boolean;
    }>("GET", "/capabilities");

  // ---------- reports ----------
  report = (target_type: Report["target_type"], target_id: string, reason: string) =>
    this.request<Report>("POST", "/reports", { target_type, target_id, reason });

  // ---------- admin ----------
  admin = {
    stats: () => this.request<Record<string, number>>("GET", "/admin/stats"),
    users: (q?: string) => this.request<UserMe[]>("GET", `/admin/users${qs({ q })}`),
    patchUser: (id: string, body: { is_admin?: boolean; is_active?: boolean }) =>
      this.request<UserMe>("PATCH", `/admin/users/${id}`, body),
    characters: (q?: string) =>
      this.request<CharacterCard[]>("GET", `/admin/characters${qs({ q })}`),
    patchCharacter: (id: string, body: { featured?: boolean; is_removed?: boolean }) =>
      this.request<CharacterCard>("PATCH", `/admin/characters/${id}`, body),
    reports: (status = "open") => this.request<Report[]>("GET", `/admin/reports${qs({ status })}`),
    patchReport: (id: string, status: Report["status"]) =>
      this.request<Report>("PATCH", `/admin/reports/${id}`, { status }),
    settings: () =>
      this.request<{ values: Record<string, unknown>; filter_categories: Record<string, string> }>(
        "GET",
        "/admin/settings",
      ),
    patchSettings: (body: Record<string, unknown>) =>
      this.request<{ values: Record<string, unknown> }>("PATCH", "/admin/settings", body),
    invites: () =>
      this.request<{ code: string; max_uses: number; uses: number; expires_at: string | null }[]>(
        "GET",
        "/admin/invites",
      ),
    createInvite: (max_uses = 1, expires_days: number | null = 7) =>
      this.request<{ code: string }>("POST", "/admin/invites", { max_uses, expires_days }),
    deleteInvite: (code: string) => this.request<void>("DELETE", `/admin/invites/${code}`),
    doctor: () =>
      this.request<{ name: string; status: string; detail: string }[]>("GET", "/admin/doctor"),
    llmModels: () => this.request<string[]>("GET", "/admin/llm-models"),
  };
}

function qs(params: Record<string, unknown>): string {
  const p = Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== "");
  if (!p.length) return "";
  return (
    "?" + p.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`).join("&")
  );
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function errorDetail(data: unknown): string | undefined {
  if (!data) return undefined;
  if (typeof data === "string") return data.slice(0, 300);
  const d = (data as { detail?: unknown }).detail;
  if (typeof d === "string") return d;
  if (Array.isArray(d) && d[0]?.msg) {
    const loc = Array.isArray(d[0].loc) ? d[0].loc.at(-1) : "";
    return `${loc ? `${loc}: ` : ""}${String(d[0].msg).replace(/^Value error, /, "")}`;
  }
  return undefined;
}

// ---------- chat socket ----------
type Listener = (ev: ChatEvent) => void;

/** Auto-reconnecting chat WebSocket. Works in browsers and React Native. */
export class ChatSocket {
  private ws: WebSocket | null = null;
  private listeners = new Set<Listener>();
  private statusListeners = new Set<(s: ChatSocket["status"]) => void>();
  private queue: string[] = [];
  private retry = 0;
  private closed = false;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  status: "idle" | "connecting" | "open" | "closed" = "idle";

  constructor(private client: PersonaClient) {}

  on(fn: Listener) {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  onStatus(fn: (s: ChatSocket["status"]) => void) {
    this.statusListeners.add(fn);
    return () => {
      this.statusListeners.delete(fn);
    };
  }

  private setStatus(s: ChatSocket["status"]) {
    this.status = s;
    this.statusListeners.forEach((f) => f(s));
  }

  async connect() {
    if (this.ws && (this.status === "open" || this.status === "connecting")) return;
    this.closed = false;
    this.setStatus("connecting");
    let token: string;
    try {
      token = await this.client.wsToken();
    } catch {
      this.scheduleReconnect();
      return;
    }
    const ws = new WebSocket(this.client.wsUrl("/ws/chat", token));
    this.ws = ws;
    ws.onopen = () => {
      this.retry = 0;
      this.setStatus("open");
      for (const m of this.queue.splice(0)) ws.send(m);
      this.pingTimer = setInterval(() => this.send({ type: "ping" }), 25_000);
    };
    ws.onmessage = (e) => {
      try {
        const ev = JSON.parse(typeof e.data === "string" ? e.data : "") as ChatEvent;
        this.listeners.forEach((f) => f(ev));
      } catch {
        /* ignore */
      }
    };
    ws.onclose = () => {
      if (this.pingTimer) clearInterval(this.pingTimer);
      this.ws = null;
      this.setStatus("closed");
      if (!this.closed) this.scheduleReconnect();
    };
    ws.onerror = () => ws.close();
  }

  private scheduleReconnect() {
    if (this.closed) return;
    const delay = Math.min(15_000, 500 * 2 ** this.retry++);
    setTimeout(() => this.connect(), delay);
  }

  send(cmd: import("./types").ChatCommand) {
    const data = JSON.stringify(cmd);
    if (this.ws && this.status === "open") this.ws.send(data);
    else if (cmd.type !== "ping") {
      this.queue.push(data);
      void this.connect();
    }
  }

  close() {
    this.closed = true;
    this.ws?.close();
  }
}
