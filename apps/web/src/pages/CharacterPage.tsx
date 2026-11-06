import { compactNumber } from "@persona/shared";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, Flag, Heart, MessageCircle, Pencil, Plus } from "lucide-react";
import { Link, useNavigate, useParams } from "react-router";
import { Avatar } from "../components/Avatar";
import { api } from "../lib/api";
import { relativeTime } from "../lib/time";
import { errorText, useToast } from "../lib/toast";

export function CharacterPage() {
  const { characterId = "" } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const qc = useQueryClient();
  const {
    data: c,
    error,
    isLoading,
  } = useQuery({ queryKey: ["character", characterId], queryFn: () => api.character(characterId) });
  const threads = useQuery({
    queryKey: ["threads", characterId],
    queryFn: () => api.characterChats(characterId),
  });

  if (isLoading)
    return (
      <div className="mx-auto max-w-3xl p-6">
        <div className="skeleton h-40 rounded-card" />
      </div>
    );
  if (error || !c)
    return (
      <div className="p-8 text-center text-ink-2">{errorText(error) || "Character not found"}</div>
    );

  const toggleLike = async () => {
    try {
      const updated = c.liked ? await api.unlike(c.id) : await api.like(c.id);
      qc.setQueryData(["character", characterId], updated);
    } catch (e) {
      toast(errorText(e), "error");
    }
  };

  const exportCard = async () => {
    try {
      const card = await api.exportCard(c.id);
      const blob = new Blob([JSON.stringify(card, null, 2)], { type: "application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `${c.name.replace(/[^\w-]+/g, "_")}.json`;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (e) {
      toast(errorText(e), "error");
    }
  };

  const report = async () => {
    const reason = prompt(`Why are you reporting ${c.name}?`);
    if (!reason || reason.trim().length < 3) return;
    await api.report("character", c.id, reason.trim());
    toast("Report sent to the admins.", "success");
  };

  const creator = c.creator?.username ?? c.creator_credit;
  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <div className="flex flex-col sm:flex-row gap-5 sm:items-center">
        <Avatar src={c.avatar_url} name={c.name} size={112} />
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-bold">{c.name}</h1>
          {creator && (
            <p className="text-sm text-ink-3">
              By{" "}
              {c.creator ? (
                <Link className="hover:text-ink" to={`/u/${c.creator.username}`}>
                  @{creator}
                </Link>
              ) : (
                `@${creator}`
              )}
            </p>
          )}
          {c.tagline && <p className="text-ink-2 mt-1.5">{c.tagline}</p>}
          <p className="text-sm text-ink-3 mt-2 flex gap-4">
            <span className="inline-flex items-center gap-1">
              <MessageCircle size={14} /> {compactNumber(c.interaction_count)} interactions
            </span>
            <span className="inline-flex items-center gap-1">
              <Heart size={14} /> {compactNumber(c.like_count)}
            </span>
          </p>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 mt-6">
        <button className="btn-primary" onClick={() => navigate(`/c/${c.id}`)}>
          <MessageCircle size={17} /> Chat
        </button>
        <button className="btn-secondary" onClick={() => navigate(`/c/${c.id}?new=1`)}>
          <Plus size={17} /> New chat
        </button>
        <button className="btn-secondary" onClick={toggleLike} aria-pressed={c.liked}>
          <Heart
            size={17}
            className={c.liked ? "text-ember" : ""}
            fill={c.liked ? "currentColor" : "none"}
          />{" "}
          {c.liked ? "Liked" : "Like"}
        </button>
        {c.is_owner && (
          <Link className="btn-secondary" to={`/character/${c.id}/edit`}>
            <Pencil size={17} /> Edit
          </Link>
        )}
        {c.is_owner && (
          <button className="btn-ghost" onClick={exportCard}>
            <Download size={17} /> Export card
          </button>
        )}
        {!c.is_owner && (
          <button className="btn-ghost" onClick={report}>
            <Flag size={17} /> Report
          </button>
        )}
      </div>

      {!!c.tags.length && (
        <div className="flex flex-wrap gap-2 mt-6">
          {c.tags.map((t) => (
            <Link key={t} to={`/?tag=${encodeURIComponent(t)}`} className="chip">
              {t}
            </Link>
          ))}
        </div>
      )}

      {c.description && (
        <section className="mt-8">
          <h2 className="font-bold mb-2">About</h2>
          <p className="text-ink-2 chat-text max-w-[70ch]">{c.description}</p>
        </section>
      )}

      {!!threads.data?.length && (
        <section className="mt-8">
          <h2 className="font-bold mb-2">Your chats</h2>
          <ul className="divide-y divide-line rounded-card bg-surface">
            {threads.data.map((t) => (
              <li key={t.id}>
                <Link
                  to={`/chat/${t.id}`}
                  className="flex items-center gap-3 px-4 py-3 hover:bg-surface-2 first:rounded-t-card last:rounded-b-card"
                >
                  <span className="flex-1 min-w-0 truncate text-sm">
                    {t.last_message || "New chat"}
                  </span>
                  <span className="text-xs text-ink-3">{relativeTime(t.updated_at)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
