// Mirrors apps/server/persona/schemas/__init__.py. Keep in sync.

export type Visibility = "public" | "unlisted" | "private";

export interface UserPublic {
  id: string;
  username: string;
  display_name: string;
  avatar_url: string | null;
  bio: string;
}

export interface Preferences {
  theme?: "dark" | "light" | "system";
  autoplay_voice?: boolean;
  default_persona_id?: string | null;
  reduce_motion?: boolean;
  language?: string;
}

export interface UserMe extends UserPublic {
  email: string | null;
  is_admin: boolean;
  is_active: boolean;
  preferences: Preferences;
  created_at: string;
}

export interface TokenOut {
  access_token: string;
  refresh_token: string;
  token_type: string;
  expires_in: number;
  user: UserMe;
}

export interface InstanceConfig {
  app: "persona";
  instance_name: string;
  invite_only: boolean;
  registration_open: boolean;
  needs_setup: boolean;
  version: string;
}

export interface Voice {
  id: string;
  name: string;
  provider: string;
  language: string;
  gender: string;
  description: string;
  preview_url: string | null;
  is_public: boolean;
  owner_id: string | null;
}

export interface CharacterCard {
  id: string;
  name: string;
  tagline: string;
  avatar_url: string | null;
  tags: string[];
  interaction_count: number;
  like_count: number;
  visibility: Visibility;
  creator: UserPublic | null;
  creator_credit: string;
  featured: boolean;
}

export interface Character extends CharacterCard {
  description: string;
  greeting: string;
  definition: string | null;
  personality: string | null;
  scenario: string | null;
  voice_id: string | null;
  voice: Voice | null;
  llm_model: string | null;
  llm_params: Record<string, number>;
  created_at: string;
  updated_at: string;
  is_owner: boolean;
  liked: boolean;
}

export interface CharacterInput {
  name: string;
  tagline?: string;
  description?: string;
  greeting?: string;
  definition?: string;
  personality?: string;
  scenario?: string;
  avatar_url?: string | null;
  voice_id?: string | null;
  visibility?: Visibility;
  tags?: string[];
  creator_credit?: string;
  llm_model?: string | null;
  llm_params?: Record<string, number>;
}

export interface Page<T> {
  items: T[];
  next_cursor: string | null;
  total?: number | null;
}

export interface Persona {
  id: string;
  name: string;
  description: string;
  avatar_url: string | null;
  is_default: boolean;
}

export interface Candidate {
  id: string;
  content: string;
  rating: number;
  model: string;
  created_at: string;
}

export interface Message {
  id: string;
  chat_id: string;
  position: number;
  role: "user" | "assistant" | "narrator";
  character_id: string | null;
  selected_candidate_id: string | null;
  is_pinned: boolean;
  created_at: string;
  candidates: Candidate[];
}

export interface Chat {
  id: string;
  character_id: string | null;
  room_id: string | null;
  persona_id: string | null;
  title: string;
  created_at: string;
  updated_at: string;
}

export interface ChatListItem extends Chat {
  character: CharacterCard | null;
  room_name: string | null;
  room_avatars: (string | null)[];
  last_message: string;
}

export interface RoomMember {
  character_id: string;
  position: number;
  character: CharacterCard;
}

export interface Room {
  id: string;
  name: string;
  topic: string;
  turn_mode: "auto" | "round_robin" | "manual";
  members: RoomMember[];
  created_at: string;
}

export interface RoomInput {
  name: string;
  topic?: string;
  character_ids: string[];
  turn_mode?: Room["turn_mode"];
}

export interface ChatDetail extends Chat {
  messages: Message[];
  character: Character | null;
  room: Room | null;
  has_more: boolean;
}

export interface Memory {
  id: string;
  kind: "pinned" | "summary";
  content: string;
  message_id: string | null;
  created_at: string;
}

export interface Job {
  id: string;
  kind: string;
  status: "queued" | "running" | "done" | "error";
  result: Record<string, unknown>;
  error: string;
  created_at: string;
  finished_at: string | null;
}

export interface Notification {
  id: string;
  kind: string;
  title: string;
  body: string;
  data: Record<string, unknown>;
  read_at: string | null;
  created_at: string;
}

export interface Report {
  id: string;
  reporter_id: string | null;
  target_type: "character" | "user" | "message";
  target_id: string;
  reason: string;
  status: "open" | "resolved" | "dismissed";
  created_at: string;
}

export interface ModelOption {
  id: string;
  label: string;
  default: boolean;
}

// Streaming events (WebSocket + SSE share the shape)
export type ChatEvent =
  | { type: "user_message"; message: Message }
  | { type: "typing"; chat_id: string; character_id: string; name: string }
  | {
      type: "start";
      chat_id: string;
      message_id: string;
      candidate_id: string;
      character_id: string;
      position: number;
      regenerate: boolean;
    }
  | { type: "delta"; candidate_id: string; text: string }
  | { type: "done"; message: Message; filtered: boolean }
  | { type: "error"; status?: number; detail: string; candidate_id?: string }
  | { type: "stopped" }
  | { type: "pong" };

export type ChatCommand =
  | { type: "send"; chat_id: string; content: string }
  | { type: "regenerate"; chat_id: string; message_id: string }
  | { type: "next"; chat_id: string; character_id?: string }
  | { type: "stop" }
  | { type: "ping" };

export function selectedCandidate(m: Message): Candidate | undefined {
  return m.candidates.find((c) => c.id === m.selected_candidate_id) ?? m.candidates.at(-1);
}

export function messageText(m: Message): string {
  return selectedCandidate(m)?.content ?? "";
}
