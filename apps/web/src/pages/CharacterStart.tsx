import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { api } from "../lib/api";
import { errorText } from "../lib/toast";

/** /c/:id resumes the latest chat with a character, or starts one. ?new=1 forces a new chat. */
export function CharacterStart() {
  const { characterId = "" } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (!params.get("new")) {
          const threads = await api.characterChats(characterId);
          if (threads.length) {
            if (!cancelled) navigate(`/chat/${threads[0].id}`, { replace: true });
            return;
          }
        }
        const chat = await api.createChat({ character_id: characterId });
        void qc.invalidateQueries({ queryKey: ["chats"] });
        if (!cancelled) navigate(`/chat/${chat.id}`, { replace: true });
      } catch (e) {
        if (!cancelled) setError(errorText(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [characterId, params, navigate, qc]);

  return (
    <div className="grid h-full place-items-center p-6 text-center">
      {error ? (
        <div>
          <p className="font-semibold">Couldn't start a chat.</p>
          <p className="text-sm text-ink-2 mt-1">{error}</p>
          <Link to="/" className="btn-secondary mt-4">
            Back to Discover
          </Link>
        </div>
      ) : (
        <p className="text-ink-3 text-sm" role="status">
          Opening chat…
        </p>
      )}
    </div>
  );
}
