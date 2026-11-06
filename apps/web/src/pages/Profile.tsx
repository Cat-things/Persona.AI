import { compactNumber } from "@persona/shared";
import { useQuery } from "@tanstack/react-query";
import { useParams } from "react-router";
import { Avatar } from "../components/Avatar";
import { CardSkeleton, CharacterCard } from "../components/CharacterCard";
import { api } from "../lib/api";
import { useUser } from "../lib/auth";
import { errorText } from "../lib/toast";

export function ProfilePage() {
  const { username = "" } = useParams();
  const me = useUser();
  const { data, isLoading, error } = useQuery({
    queryKey: ["profile", username],
    queryFn: () => api.profile(username),
  });
  const liked = useQuery({
    queryKey: ["liked"],
    queryFn: api.likedCharacters,
    enabled: me.username === username,
  });
  if (error) return <div className="p-8 text-center text-ink-2">{errorText(error)}</div>;
  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      {data ? (
        <div className="flex items-center gap-4">
          <Avatar
            src={data.user.avatar_url}
            name={data.user.display_name || data.user.username}
            size={80}
          />
          <div>
            <h1 className="text-2xl font-bold">{data.user.display_name || data.user.username}</h1>
            <p className="text-sm text-ink-3">
              @{data.user.username} · {compactNumber(data.total_interactions)} interactions
            </p>
            {data.user.bio && <p className="text-ink-2 mt-1.5 max-w-[60ch]">{data.user.bio}</p>}
          </div>
        </div>
      ) : (
        <div className="skeleton h-20 w-72 rounded-card" />
      )}
      <h2 className="text-lg font-bold mt-10 mb-3">Characters</h2>
      <div className="grid gap-3 grid-cols-[repeat(auto-fill,minmax(min(100%,300px),1fr))]">
        {isLoading && Array.from({ length: 3 }, (_, i) => <CardSkeleton key={i} />)}
        {data?.characters.map((c) => (
          <CharacterCard key={c.id} c={c} />
        ))}
      </div>
      {data && !data.characters.length && <p className="text-sm text-ink-3">No characters yet.</p>}
      {!!liked.data?.length && (
        <>
          <h2 className="text-lg font-bold mt-10 mb-3">Liked</h2>
          <div className="grid gap-3 grid-cols-[repeat(auto-fill,minmax(min(100%,300px),1fr))]">
            {liked.data.map((c) => (
              <CharacterCard key={c.id} c={c} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
