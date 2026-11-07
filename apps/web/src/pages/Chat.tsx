import type { Memory, Message } from "@persona/shared";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Brain, History, Info, Menu, MoreVertical, Plus, Trash2, Users } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useOutletContext, useParams } from "react-router";
import type { ShellContext } from "../components/AppShell";
import { Avatar } from "../components/Avatar";
import { Composer } from "../components/Composer";
import { MessageItem, TypingDots, type Speaker } from "../components/MessageItem";
import { ConfirmModal, Modal } from "../components/Modal";
import { Popover } from "../components/Popover";
import { useChatSession } from "../hooks/useChatSession";
import { api } from "../lib/api";
import { useUser } from "../lib/auth";
import { relativeTime } from "../lib/time";
import { errorText, useToast } from "../lib/toast";
import { useChatExtras } from "./chatExtras";

function MemoriesModal({
  chatId,
  open,
  onClose,
}: {
  chatId: string;
  open: boolean;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const { data, isLoading } = useQuery({
    queryKey: ["memories", chatId],
    queryFn: () => api.memories(chatId),
    enabled: open,
  });
  const [draft, setDraft] = useState("");
  const refresh = () => qc.invalidateQueries({ queryKey: ["memories", chatId] });
  const summary = data?.find((m) => m.kind === "summary");
  const pinned = data?.filter((m) => m.kind === "pinned") ?? [];

  const add = async () => {
    try {
      await api.addMemory(chatId, draft.trim());
      setDraft("");
      void refresh();
    } catch (e) {
      toast(errorText(e), "error");
    }
  };
  const del = async (m: Memory) => {
    await api.deleteMemory(m.id);
    void refresh();
  };

  return (
    <Modal open={open} onClose={onClose} title="Memory">
      <p className="text-sm text-ink-2 mb-4">
        Pinned memories are always included in the character's context, even when old messages fall
        out of it.
      </p>
      <div className="flex gap-2 mb-4">
        <label htmlFor="new-memory" className="sr-only">
          New memory
        </label>
        <input
          id="new-memory"
          className="field"
          placeholder="e.g. My character is afraid of heights"
          value={draft}
          maxLength={2000}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && draft.trim() && add()}
        />
        <button className="btn-primary" disabled={!draft.trim()} onClick={add}>
          Add
        </button>
      </div>
      {isLoading && <div className="skeleton h-16 rounded-card" />}
      <ul className="space-y-2">
        {pinned.map((m) => (
          <li
            key={m.id}
            className="flex items-start gap-2 rounded-control bg-surface-2 px-3 py-2.5"
          >
            <span className="flex-1 text-sm chat-text">{m.content}</span>
            <button className="icon-btn size-7" onClick={() => del(m)} aria-label="Delete memory">
              <Trash2 size={14} />
            </button>
          </li>
        ))}
      </ul>
      {!isLoading && !pinned.length && (
        <p className="text-sm text-ink-3">Nothing pinned yet. Use a message's menu to pin it.</p>
      )}
      {summary && (
        <div className="mt-5">
          <h3 className="text-sm font-semibold mb-1.5">
            Story so far <span className="font-normal text-ink-3">(automatic summary)</span>
          </h3>
          <p className="text-sm text-ink-2 chat-text rounded-control bg-surface-2 px-3 py-2.5">
            {summary.content}
          </p>
        </div>
      )}
    </Modal>
  );
}

function ThreadsModal({
  characterId,
  currentId,
  open,
  onClose,
  onNew,
}: {
  characterId: string;
  currentId: string;
  open: boolean;
  onClose: () => void;
  onNew: () => void;
}) {
  const { data } = useQuery({
    queryKey: ["threads", characterId],
    queryFn: () => api.characterChats(characterId),
    enabled: open,
  });
  return (
    <Modal open={open} onClose={onClose} title="Chat history">
      <button className="btn-secondary w-full mb-3" onClick={onNew}>
        <Plus size={16} /> New chat
      </button>
      <ul className="space-y-1">
        {data?.map((c) => (
          <li key={c.id}>
            <Link
              to={`/chat/${c.id}`}
              onClick={onClose}
              className="flex items-center gap-3 rounded-control px-3 py-2.5 hover:bg-surface-2"
              aria-current={c.id === currentId ? "page" : undefined}
            >
              <span className="flex-1 min-w-0">
                <span className="block text-sm truncate">{c.last_message || "New chat"}</span>
                <span className="block text-xs text-ink-3">
                  {relativeTime(c.updated_at)}
                  {c.id === currentId ? " · current" : ""}
                </span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </Modal>
  );
}

export function ChatPage() {
  const { chatId = "" } = useParams();
  const user = useUser();
  const navigate = useNavigate();
  const toast = useToast();
  const qc = useQueryClient();
  const { openDrawer } = useOutletContext<ShellContext>();
  const s = useChatSession(chatId);
  const [modal, setModal] = useState<null | "memory" | "threads" | "delete-chat">(null);
  const [confirmMsg, setConfirmMsg] = useState<{ m: Message; rewind: boolean } | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);

  const character = s.detail?.character ?? null;
  const room = s.detail?.room ?? null;
  const title = character?.name ?? room?.name ?? s.detail?.title ?? "";

  const speakers = useMemo(() => {
    const map = new Map<string, Speaker>();
    if (character) map.set(character.id, { name: character.name, avatar: character.avatar_url });
    room?.members.forEach((m) =>
      map.set(m.character_id, { name: m.character.name, avatar: m.character.avatar_url }),
    );
    return map;
  }, [character, room]);
  const speakerFor = useCallback(
    (id: string | null): Speaker =>
      (id && speakers.get(id)) || { name: title || "Character", avatar: null },
    [speakers, title],
  );

  // stick to bottom while streaming if the user is already there
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && atBottom.current) el.scrollTop = el.scrollHeight;
  }, [s.messages, s.typing]);
  useEffect(() => {
    atBottom.current = true;
  }, [chatId]);

  const onScroll = () => {
    const el = scroller.current;
    if (!el) return;
    atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    if (el.scrollTop < 120 && s.hasMore) {
      const prev = el.scrollHeight;
      void s.loadOlder().then(() =>
        requestAnimationFrame(() => {
          el.scrollTop = el.scrollHeight - prev + el.scrollTop;
        }),
      );
    }
  };

  const newChat = async () => {
    try {
      const c = await api.createChat(
        character ? { character_id: character.id } : { room_id: room!.id },
      );
      setModal(null);
      void qc.invalidateQueries({ queryKey: ["chats"] });
      navigate(`/chat/${c.id}`);
    } catch (e) {
      toast(errorText(e), "error");
    }
  };

  const deleteChat = async () => {
    await api.deleteChat(chatId);
    void qc.invalidateQueries({ queryKey: ["chats"] });
    navigate("/");
  };

  const report = async (m: Message) => {
    const reason = prompt("What's wrong with this reply?");
    if (!reason || reason.trim().length < 3) return;
    try {
      await api.report("message", m.id, reason.trim());
      toast("Thanks, the admins will take a look.", "success");
    } catch (e) {
      toast(errorText(e), "error");
    }
  };

  const extras = useChatExtras({ chatId, character, room, session: s });

  if (s.loadError) {
    return (
      <div className="grid h-full place-items-center p-6 text-center">
        <div>
          <p className="font-semibold">This chat couldn't be opened.</p>
          <p className="text-sm text-ink-2 mt-1">{s.loadError}</p>
          <Link to="/" className="btn-secondary mt-4">
            Back to Discover
          </Link>
        </div>
      </div>
    );
  }

  const lastId = s.messages.at(-1)?.id;
  const creator = character?.creator?.username ?? character?.creator_credit;

  return (
    <div className="flex h-full flex-col">
      <header className="sticky top-0 z-(--z-sticky) flex items-center gap-2 border-b border-line bg-bg/95 px-2 sm:px-4 h-14 sm:h-16 shrink-0">
        <button className="icon-btn size-11 md:hidden" onClick={openDrawer} aria-label="Open menu">
          <Menu size={20} />
        </button>
        {s.loading && !s.detail ? (
          <div className="flex items-center gap-3">
            <div className="skeleton size-9 rounded-full" />
            <div className="skeleton h-4 w-32 rounded" />
          </div>
        ) : (
          <Link
            to={character ? `/character/${character.id}` : "#"}
            className="flex min-w-0 items-center gap-3 rounded-control px-1 py-1 hover:bg-surface"
          >
            {room ? (
              <span className="flex -space-x-3">
                {room.members.slice(0, 3).map((m) => (
                  <Avatar
                    key={m.character_id}
                    src={m.character.avatar_url}
                    name={m.character.name}
                    size={34}
                    ring
                  />
                ))}
              </span>
            ) : (
              <Avatar src={character?.avatar_url} name={title} size={38} />
            )}
            <span className="min-w-0">
              <span className="block truncate font-bold leading-tight">{title}</span>
              <span className="block truncate text-xs text-ink-3">
                {room ? `${room.members.length} characters` : creator ? `By @${creator}` : ""}
              </span>
            </span>
          </Link>
        )}
        <div className="ml-auto flex items-center gap-1">
          {extras.headerActions}
          <Popover
            label="Chat options"
            trigger={(p) => (
              <button {...p} className="icon-btn size-10">
                <MoreVertical size={18} />
              </button>
            )}
          >
            {(close) => (
              <>
                <button
                  className="menu-item"
                  onClick={() => {
                    close();
                    void newChat();
                  }}
                >
                  <Plus size={16} /> New chat
                </button>
                {character && (
                  <button
                    className="menu-item"
                    onClick={() => {
                      close();
                      setModal("threads");
                    }}
                  >
                    <History size={16} /> Chat history
                  </button>
                )}
                <button
                  className="menu-item"
                  onClick={() => {
                    close();
                    setModal("memory");
                  }}
                >
                  <Brain size={16} /> Memory
                </button>
                {character && (
                  <button
                    className="menu-item"
                    onClick={() => {
                      close();
                      navigate(`/character/${character.id}`);
                    }}
                  >
                    <Info size={16} /> About {character.name}
                  </button>
                )}
                {room && (
                  <button
                    className="menu-item"
                    onClick={() => {
                      close();
                      navigate(`/rooms/${room.id}/edit`);
                    }}
                  >
                    <Users size={16} /> Edit room
                  </button>
                )}
                {extras.menuItems?.(close)}
                <div className="my-1 border-t border-line" />
                <button
                  className="menu-item text-err"
                  onClick={() => {
                    close();
                    setModal("delete-chat");
                  }}
                >
                  <Trash2 size={16} /> Delete chat
                </button>
              </>
            )}
          </Popover>
        </div>
      </header>

      <div
        ref={scroller}
        onScroll={onScroll}
        className="flex-1 overflow-y-auto scroll-thin"
        aria-live="off"
      >
        <div className="mx-auto w-full max-w-3xl px-3 sm:px-6 py-6 space-y-4">
          {character && (
            <div className="flex flex-col items-center text-center pb-4">
              <Avatar src={character.avatar_url} name={character.name} size={72} />
              <h1 className="font-bold text-lg mt-2">{character.name}</h1>
              {character.tagline && (
                <p className="text-sm text-ink-2 max-w-md">{character.tagline}</p>
              )}
              {creator && <p className="text-xs text-ink-3 mt-1">By @{creator}</p>}
            </div>
          )}
          {s.loading && !s.messages.length && (
            <div className="space-y-4">
              <div className="flex gap-3">
                <div className="skeleton size-9 rounded-full" />
                <div className="skeleton h-16 w-2/3 rounded-bubble" />
              </div>
              <div className="flex justify-end">
                <div className="skeleton h-10 w-1/3 rounded-bubble" />
              </div>
            </div>
          )}
          {s.messages.map((m) => (
            <MessageItem
              key={m.id}
              m={m}
              speaker={
                m.role === "user"
                  ? { name: user.display_name, avatar: user.avatar_url }
                  : speakerFor(m.character_id)
              }
              isLast={m.id === lastId}
              streaming={m.selected_candidate_id === s.streamingId}
              busy={s.busy}
              onSwipe={s.swipe}
              onRate={s.rate}
              onEdit={s.edit}
              onDelete={(msg) => setConfirmMsg({ m: msg, rewind: false })}
              onRewind={(msg) => setConfirmMsg({ m: msg, rewind: true })}
              onPin={s.togglePin}
              onReport={report}
              extraActions={extras.messageActions?.(m)}
            />
          ))}
          {s.typing && (
            <div className="flex gap-3 fade-in">
              <Avatar
                src={speakerFor(s.typing.characterId).avatar}
                name={s.typing.name}
                size={36}
              />
              <div>
                <span className="block text-sm font-semibold mb-1">{s.typing.name}</span>
                <TypingDots label={`${s.typing.name} is typing`} />
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="shrink-0 px-3 sm:px-6 pb-[max(12px,env(safe-area-inset-bottom))] pt-2">
        <div className="mx-auto max-w-3xl">
          {extras.aboveComposer}
          <Composer
            draftKey={`draft:${chatId}`}
            placeholder={`Message ${title || "character"}…`}
            busy={s.busy}
            disabled={s.loading}
            onSend={(t) => {
              atBottom.current = true;
              s.send(t);
            }}
            onStop={s.stop}
            onCall={extras.onCall}
            micSlot={extras.micSlot}
          />
          <p className="text-center text-[11px] text-ink-3 mt-1.5">
            Characters are AI and make things up. Don't treat replies as fact.
          </p>
        </div>
      </div>

      {character && (
        <ThreadsModal
          characterId={character.id}
          currentId={chatId}
          open={modal === "threads"}
          onClose={() => setModal(null)}
          onNew={newChat}
        />
      )}
      <MemoriesModal chatId={chatId} open={modal === "memory"} onClose={() => setModal(null)} />
      <ConfirmModal
        open={modal === "delete-chat"}
        onClose={() => setModal(null)}
        onConfirm={deleteChat}
        title="Delete this chat?"
        body="All messages and memories in this chat will be removed. This can't be undone."
        confirmLabel="Delete chat"
        danger
      />
      <ConfirmModal
        open={!!confirmMsg}
        onClose={() => setConfirmMsg(null)}
        onConfirm={() => confirmMsg && s.remove(confirmMsg.m, confirmMsg.rewind)}
        title={confirmMsg?.rewind ? "Rewind to this message?" : "Delete this message?"}
        body={
          confirmMsg?.rewind
            ? "This message and everything after it will be deleted."
            : "The message will be removed from the chat."
        }
        confirmLabel={confirmMsg?.rewind ? "Rewind" : "Delete"}
        danger
      />
      {extras.overlay}
    </div>
  );
}
