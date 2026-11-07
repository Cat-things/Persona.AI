import { router } from "expo-router";
import { api } from "./api";

/** Continue the latest chat with a character, or start the first one. */
export async function chatWith(characterId: string, fresh = false) {
  if (!fresh) {
    const chats = await api.characterChats(characterId);
    if (chats.length) {
      router.push(`/chat/${chats[0].id}`);
      return;
    }
  }
  const chat = await api.createChat({ character_id: characterId });
  router.push(`/chat/${chat.id}`);
}
