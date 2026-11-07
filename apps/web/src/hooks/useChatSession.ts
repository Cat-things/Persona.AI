import type { ChatDetail, ChatEvent, Message, RefusalNotice } from "@persona/shared";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, chatSocket } from "../lib/api";
import { errorText, useToast } from "../lib/toast";

export interface Typing {
  characterId: string;
  name: string;
}

/**
 * Owns the message list for one chat and applies streaming events from the shared socket.
 * One generation at a time (the server enforces the same).
 */
export function useChatSession(chatId: string) {
  const qc = useQueryClient();
  const toast = useToast();
  const [detail, setDetail] = useState<ChatDetail | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [busy, setBusy] = useState(false);
  const [typing, setTyping] = useState<Typing | null>(null);
  const [streamingId, setStreamingId] = useState<string | null>(null); // candidate id
  const [lastDone, setLastDone] = useState<Message | null>(null);
  // Latest refusal warning (banner or stop popup); cleared by the UI when dismissed.
  const [refusal, setRefusal] = useState<{ notice: RefusalNotice; name: string } | null>(null);
  const speakerName = useRef("");
  const activeCandidates = useRef(new Set<string>());
  const busyRef = useRef(false);
  busyRef.current = busy;

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const d = await api.chat(chatId);
      setDetail(d);
      setMessages(d.messages);
      setHasMore(d.has_more);
    } catch (e) {
      setLoadError(errorText(e));
    } finally {
      setLoading(false);
    }
  }, [chatId]);

  useEffect(() => {
    setDetail(null);
    setMessages([]);
    setBusy(false);
    setTyping(null);
    void load();
  }, [load]);

  const loadOlder = useCallback(async () => {
    if (!hasMore || !messages.length) return;
    const d = await api.chat(chatId, messages[0].position);
    setMessages((m) => [...d.messages, ...m]);
    setHasMore(d.has_more);
  }, [chatId, hasMore, messages]);

  // socket events
  useEffect(() => {
    return chatSocket.on((ev: ChatEvent) => {
      switch (ev.type) {
        case "user_message":
          if (ev.message.chat_id !== chatId) return;
          setMessages((ms) => {
            const i = ms.findIndex((m) => m.id.startsWith("tmp-"));
            if (i === -1) return [...ms, ev.message];
            const copy = ms.slice();
            copy[i] = ev.message;
            return copy;
          });
          return;
        case "typing":
          if (ev.chat_id !== chatId) return;
          setTyping({ characterId: ev.character_id, name: ev.name });
          speakerName.current = ev.name;
          return;
        case "start":
          if (ev.chat_id !== chatId) return;
          activeCandidates.current.add(ev.candidate_id);
          setStreamingId(ev.candidate_id);
          setTyping(null);
          setMessages((ms) => {
            const cand = {
              id: ev.candidate_id,
              content: "",
              rating: 0,
              model: "",
              created_at: new Date().toISOString(),
            };
            if (ev.regenerate) {
              return ms.map((m) =>
                m.id === ev.message_id
                  ? { ...m, candidates: [...m.candidates, cand], selected_candidate_id: cand.id }
                  : m,
              );
            }
            return [
              ...ms,
              {
                id: ev.message_id,
                chat_id: chatId,
                position: ev.position,
                role: "assistant",
                character_id: ev.character_id,
                selected_candidate_id: cand.id,
                is_pinned: false,
                created_at: cand.created_at,
                candidates: [cand],
              },
            ];
          });
          return;
        case "delta":
          if (!activeCandidates.current.has(ev.candidate_id)) return;
          setMessages((ms) =>
            ms.map((m) =>
              m.selected_candidate_id === ev.candidate_id
                ? {
                    ...m,
                    candidates: m.candidates.map((c) =>
                      c.id === ev.candidate_id ? { ...c, content: c.content + ev.text } : c,
                    ),
                  }
                : m,
            ),
          );
          return;
        case "done":
          if (ev.message.chat_id !== chatId) return;
          setMessages((ms) => ms.map((m) => (m.id === ev.message.id ? ev.message : m)));
          setStreamingId(null);
          setLastDone(ev.message);
          if (ev.refusal) setRefusal({ notice: ev.refusal, name: speakerName.current });
          else if (ev.filtered) toast("A reply was hidden by this server's content filter.");
          return;
        case "error":
          if (!busyRef.current) return;
          toast(ev.detail || "Generation failed", "error");
          setTyping(null);
          setStreamingId(null);
          setBusy(false);
          void load();
          return;
        case "stopped":
          if (!busyRef.current) return;
          setTyping(null);
          setStreamingId(null);
          setBusy(false);
          return;
      }
    });
  }, [chatId, load, toast]);

  // A turn is over when the last "done" arrives and nothing new starts shortly after (rooms
  // can chain several speakers). The server sends typing->start for each speaker.
  useEffect(() => {
    if (!lastDone || !busy) return;
    const t = setTimeout(() => {
      setBusy(false);
      setTyping(null);
      void qc.invalidateQueries({ queryKey: ["chats"] });
    }, 350);
    return () => clearTimeout(t);
  }, [lastDone, busy, qc]);
  useEffect(() => {
    if (typing || streamingId) setLastDone(null);
  }, [typing, streamingId]);

  const send = useCallback(
    (content: string) => {
      if (busyRef.current || !content.trim()) return;
      setBusy(true);
      setLastDone(null);
      const tmp: Message = {
        id: `tmp-${Date.now()}`,
        chat_id: chatId,
        position: (messages.at(-1)?.position ?? -1) + 1,
        role: "user",
        character_id: null,
        selected_candidate_id: "tmp",
        is_pinned: false,
        created_at: new Date().toISOString(),
        candidates: [{ id: "tmp", content: content.trim(), rating: 0, model: "", created_at: "" }],
      };
      setMessages((ms) => [...ms, tmp]);
      chatSocket.send({ type: "send", chat_id: chatId, content: content.trim() });
    },
    [chatId, messages],
  );

  const regenerate = useCallback(
    (messageId: string) => {
      if (busyRef.current) return;
      setBusy(true);
      setLastDone(null);
      chatSocket.send({ type: "regenerate", chat_id: chatId, message_id: messageId });
    },
    [chatId],
  );

  const nextTurn = useCallback(
    (characterId?: string) => {
      if (busyRef.current) return;
      setBusy(true);
      setLastDone(null);
      chatSocket.send({ type: "next", chat_id: chatId, character_id: characterId });
    },
    [chatId],
  );

  const stop = useCallback(() => chatSocket.send({ type: "stop" }), []);

  const replace = useCallback(
    (m: Message) => setMessages((ms) => ms.map((x) => (x.id === m.id ? m : x))),
    [],
  );

  const swipe = useCallback(
    async (m: Message, dir: -1 | 1) => {
      const idx = m.candidates.findIndex((c) => c.id === m.selected_candidate_id);
      const target = idx + dir;
      if (target < 0) return;
      if (target >= m.candidates.length) {
        if (messages.at(-1)?.id === m.id) regenerate(m.id);
        return;
      }
      const cand = m.candidates[target];
      replace({ ...m, selected_candidate_id: cand.id });
      try {
        await api.selectCandidate(m.id, cand.id);
      } catch (e) {
        toast(errorText(e), "error");
      }
    },
    [messages, regenerate, replace, toast],
  );

  const rate = useCallback(
    async (m: Message, rating: number) => {
      const cid = m.selected_candidate_id!;
      replace({ ...m, candidates: m.candidates.map((c) => (c.id === cid ? { ...c, rating } : c)) });
      try {
        await api.rate(cid, rating);
      } catch (e) {
        toast(errorText(e), "error");
      }
    },
    [replace, toast],
  );

  const edit = useCallback(
    async (m: Message, content: string) => {
      try {
        replace(await api.editMessage(m.id, content));
      } catch (e) {
        toast(errorText(e), "error");
      }
    },
    [replace, toast],
  );

  const remove = useCallback(
    async (m: Message, andAfter = false) => {
      try {
        await api.deleteMessage(m.id, andAfter);
        setMessages((ms) => ms.filter((x) => (andAfter ? x.position < m.position : x.id !== m.id)));
      } catch (e) {
        toast(errorText(e), "error");
      }
    },
    [toast],
  );

  const togglePin = useCallback(
    async (m: Message) => {
      try {
        if (m.is_pinned) await api.unpin(m.id);
        else await api.pin(m.id);
        replace({ ...m, is_pinned: !m.is_pinned });
        toast(m.is_pinned ? "Removed from memory" : "Pinned to memory", "success");
        void qc.invalidateQueries({ queryKey: ["memories", chatId] });
      } catch (e) {
        toast(errorText(e), "error");
      }
    },
    [chatId, qc, replace, toast],
  );

  const clearRefusal = useCallback(() => setRefusal(null), []);

  return {
    refusal,
    clearRefusal,
    detail,
    setDetail,
    messages,
    loading,
    loadError,
    hasMore,
    loadOlder,
    busy,
    typing,
    streamingId,
    send,
    regenerate,
    nextTurn,
    stop,
    swipe,
    rate,
    edit,
    remove,
    togglePin,
    reload: load,
  };
}
