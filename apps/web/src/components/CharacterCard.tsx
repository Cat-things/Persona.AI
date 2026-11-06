import { compactNumber, type CharacterCard as Card } from "@persona/shared";
import { MessageCircle } from "lucide-react";
import { Link } from "react-router";
import { Avatar } from "./Avatar";

export function CharacterCard({ c }: { c: Card }) {
  const creator = c.creator?.username ?? c.creator_credit;
  return (
    <Link
      to={`/c/${c.id}`}
      className="group flex gap-3.5 rounded-card bg-surface p-3.5 transition-colors duration-150 hover:bg-surface-2 focus-visible:bg-surface-2 min-w-0"
    >
      <Avatar src={c.avatar_url} name={c.name} size={84} className="rounded-xl!" />
      <div className="min-w-0 flex flex-col py-0.5">
        <h3 className="font-bold text-ink truncate">{c.name}</h3>
        {creator && <p className="text-xs text-ink-3 truncate">By @{creator}</p>}
        <p className="text-sm text-ink-2 line-clamp-2 mt-1 leading-snug">{c.tagline || " "}</p>
        <p className="mt-auto pt-1.5 text-xs text-ink-3 inline-flex items-center gap-1">
          <MessageCircle size={13} aria-hidden="true" />
          <span>{compactNumber(c.interaction_count)}</span>
          <span className="sr-only">interactions</span>
        </p>
      </div>
    </Link>
  );
}

/** Taller card used in horizontal "featured" rails. */
export function FeaturedCard({ c }: { c: Card }) {
  return (
    <Link
      to={`/c/${c.id}`}
      className="group shrink-0 w-40 sm:w-44 snap-start rounded-card bg-surface p-3 transition-colors duration-150 hover:bg-surface-2"
    >
      <Avatar
        src={c.avatar_url}
        name={c.name}
        size={152}
        className="rounded-xl! w-full! h-auto! aspect-square"
      />
      <h3 className="font-bold mt-2.5 truncate">{c.name}</h3>
      <p className="text-xs text-ink-3 truncate">By @{c.creator?.username ?? c.creator_credit}</p>
      <p className="text-sm text-ink-2 line-clamp-2 mt-1 leading-snug min-h-[2.5em]">{c.tagline}</p>
      <p className="mt-1.5 text-xs text-ink-3 inline-flex items-center gap-1">
        <MessageCircle size={13} aria-hidden="true" /> {compactNumber(c.interaction_count)}
      </p>
    </Link>
  );
}

export function CardSkeleton() {
  return (
    <div className="flex gap-3.5 rounded-card bg-surface p-3.5">
      <div className="skeleton size-[84px] rounded-xl" />
      <div className="flex-1 space-y-2 py-1">
        <div className="skeleton h-4 w-2/3 rounded" />
        <div className="skeleton h-3 w-1/3 rounded" />
        <div className="skeleton h-3 w-full rounded" />
      </div>
    </div>
  );
}
