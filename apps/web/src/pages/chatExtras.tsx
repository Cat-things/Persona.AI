import type { Character, Message, Room } from "@persona/shared";
import { MessageSquarePlus } from "lucide-react";
import type { ReactNode } from "react";
import type { useChatSession } from "../hooks/useChatSession";

export interface ChatExtras {
  headerActions?: ReactNode;
  menuItems?: (close: () => void) => ReactNode;
  messageActions?: (m: Message) => ReactNode;
  aboveComposer?: ReactNode;
  micSlot?: ReactNode;
  onCall?: () => void;
}

/** Feature hooks for the chat view (voice, calls, rooms). Grows with later phases. */
export function useChatExtras({
  room,
  session,
}: {
  chatId: string;
  character: Character | null;
  room: Room | null;
  session: ReturnType<typeof useChatSession>;
}): ChatExtras {
  const extras: ChatExtras = {};
  if (room) {
    extras.aboveComposer = (
      <div className="flex flex-wrap items-center gap-2 mb-2">
        <span className="text-xs text-ink-3">Let someone speak:</span>
        {room.members.map((m) => (
          <button
            key={m.character_id}
            className="chip h-7 text-xs"
            disabled={session.busy}
            onClick={() => session.nextTurn(m.character_id)}
          >
            {m.character.name}
          </button>
        ))}
        <button
          className="chip h-7 text-xs"
          disabled={session.busy}
          onClick={() => session.nextTurn()}
        >
          <MessageSquarePlus size={13} /> Anyone
        </button>
      </div>
    );
  }
  return extras;
}
