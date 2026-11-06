import type { CharacterCard as Card } from "@persona/shared";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { Search, Sparkles } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { CardSkeleton, CharacterCard, FeaturedCard } from "../components/CharacterCard";
import { api } from "../lib/api";
import { useUser } from "../lib/auth";
import { useChats } from "../components/AppShell";
import { Avatar } from "../components/Avatar";

type Sort = "popular" | "trending" | "recent";
const SORTS: { id: Sort; label: string }[] = [
  { id: "popular", label: "Popular" },
  { id: "trending", label: "Trending" },
  { id: "recent", label: "New" },
];

function greeting() {
  const h = new Date().getHours();
  return h < 5 ? "Up late" : h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

function useDebounced<T>(v: T, ms = 250) {
  const [d, setD] = useState(v);
  useEffect(() => {
    const t = setTimeout(() => setD(v), ms);
    return () => clearTimeout(t);
  }, [v, ms]);
  return d;
}

function Rail({ title, items }: { title: string; items: Card[] }) {
  if (!items.length) return null;
  return (
    <section className="mt-8">
      <h2 className="text-lg font-bold mb-3">{title}</h2>
      <div className="flex gap-3 overflow-x-auto no-scrollbar snap-x scroll-pl-4 -mx-4 px-4 md:mx-0 md:px-0 md:scroll-pl-0 pb-1">
        {items.map((c) => (
          <FeaturedCard key={c.id} c={c} />
        ))}
      </div>
    </section>
  );
}

export function DiscoverPage() {
  const user = useUser();
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState(params.get("q") ?? "");
  const tag = params.get("tag") ?? "";
  const sort = (params.get("sort") as Sort) || "popular";
  const dq = useDebounced(q.trim());
  const searching = !!dq || !!tag;

  const featured = useQuery({
    queryKey: ["discover", "featured"],
    queryFn: () => api.discover({ sort: "featured", limit: 12 }),
  });
  const trending = useQuery({
    queryKey: ["discover", "trending-rail"],
    queryFn: () => api.discover({ sort: "trending", limit: 12 }),
  });
  const tags = useQuery({ queryKey: ["tags"], queryFn: api.tags, staleTime: 60_000 });
  const { data: chats } = useChats();

  const feed = useInfiniteQuery({
    queryKey: ["discover", sort, dq, tag],
    queryFn: ({ pageParam }) =>
      api.discover({
        sort,
        q: dq || undefined,
        tag: tag || undefined,
        cursor: pageParam,
        limit: 24,
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.next_cursor ?? undefined,
  });
  const items = feed.data?.pages.flatMap((p) => p.items) ?? [];

  const sentinel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (e) => {
        if (e[0].isIntersecting && feed.hasNextPage && !feed.isFetchingNextPage)
          void feed.fetchNextPage();
      },
      { rootMargin: "400px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [feed]);

  const setParam = (k: string, v: string) => {
    const p = new URLSearchParams(params);
    if (v) p.set(k, v);
    else p.delete(k);
    setParams(p, { replace: true });
  };

  const recent = (chats ?? []).filter((c) => c.character).slice(0, 8);

  return (
    <div className="mx-auto max-w-6xl px-4 pt-6 pb-16 md:pt-10">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-ink-3 text-sm">{greeting()},</p>
          <h1 className="text-2xl md:text-[1.75rem] font-bold leading-tight">
            {user.display_name || user.username}
          </h1>
        </div>
        <label className="relative sm:w-80">
          <span className="sr-only">Search characters</span>
          <Search
            size={17}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-3"
            aria-hidden="true"
          />
          <input
            type="search"
            className="field rounded-full pl-10 h-11"
            placeholder="Search characters or tags"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setParam("q", e.target.value.trim());
            }}
          />
        </label>
      </div>

      {!searching && recent.length > 0 && (
        <section className="mt-7">
          <h2 className="text-lg font-bold mb-3">Continue chatting</h2>
          <div className="flex gap-4 overflow-x-auto no-scrollbar -mx-4 px-4 md:mx-0 md:px-0">
            {recent.map((c) => (
              <Link key={c.id} to={`/chat/${c.id}`} className="shrink-0 w-[72px] text-center group">
                <Avatar
                  src={c.character!.avatar_url}
                  name={c.character!.name}
                  size={64}
                  className="mx-auto transition-transform duration-150 group-hover:scale-105"
                />
                <span className="block text-xs mt-1.5 truncate text-ink-2 group-hover:text-ink">
                  {c.character!.name}
                </span>
              </Link>
            ))}
          </div>
        </section>
      )}

      {!searching && <Rail title="Featured" items={featured.data?.items ?? []} />}
      {!searching && <Rail title="Trending this week" items={trending.data?.items ?? []} />}

      <section className="mt-9">
        <div className="flex flex-wrap items-center gap-2 mb-4">
          {!searching ? (
            SORTS.map((s) => (
              <button
                key={s.id}
                className="chip"
                aria-pressed={sort === s.id}
                onClick={() => setParam("sort", s.id === "popular" ? "" : s.id)}
              >
                {s.label}
              </button>
            ))
          ) : (
            <h2 className="text-lg font-bold mr-2">
              {tag ? `Tagged “${tag}”` : `Results for “${dq}”`}
            </h2>
          )}
          <span className="mx-1 h-5 w-px bg-line" aria-hidden="true" />
          <div className="flex gap-2 overflow-x-auto no-scrollbar min-w-0 flex-1">
            {(tags.data ?? []).slice(0, 14).map((t) => (
              <button
                key={t.tag}
                className="chip"
                aria-pressed={tag === t.tag}
                onClick={() => setParam("tag", tag === t.tag ? "" : t.tag)}
              >
                {t.tag}
              </button>
            ))}
          </div>
        </div>

        <div className="grid gap-3 grid-cols-[repeat(auto-fill,minmax(min(100%,300px),1fr))]">
          {feed.isLoading && Array.from({ length: 9 }, (_, i) => <CardSkeleton key={i} />)}
          {items.map((c) => (
            <CharacterCard key={c.id} c={c} />
          ))}
        </div>
        {!feed.isLoading && !items.length && (
          <div className="rounded-card bg-surface p-8 text-center">
            <Sparkles className="mx-auto text-ember" aria-hidden="true" />
            <p className="font-semibold mt-3">
              {searching ? "No characters match that." : "No public characters yet."}
            </p>
            <p className="text-sm text-ink-2 mt-1">
              {searching
                ? "Try a different name or tag."
                : "Create the first one, or import a character card."}
            </p>
            <Link to="/create" className="btn-primary mt-4">
              Create a character
            </Link>
          </div>
        )}
        <div ref={sentinel} />
        {feed.isFetchingNextPage && (
          <p className="text-center text-sm text-ink-3 mt-4">Loading more…</p>
        )}
      </section>
    </div>
  );
}
