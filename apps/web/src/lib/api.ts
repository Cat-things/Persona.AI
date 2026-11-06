import { ChatSocket, PersonaClient } from "@persona/shared";

export const api = new PersonaClient({ baseUrl: import.meta.env.VITE_API_URL ?? "" });
export const chatSocket = new ChatSocket(api);

export const media = (p: string | null | undefined) => api.mediaUrl(p);
