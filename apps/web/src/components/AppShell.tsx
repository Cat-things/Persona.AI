import { historyBucket, type ChatListItem, type HistoryBucket } from "@persona/shared";
import { useQuery } from "@tanstack/react-query";
import clsx from "clsx";
import {
  Compass,
  LogOut,
  Menu,
  Moon,
  Plus,
  Search,
  Settings,
  Shield,
  Sun,
  UserRound,
  Users,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, NavLink, Outlet, useLocation, useNavigate, useParams } from "react-router";
import { api } from "../lib/api";
import { useAuth, useUser } from "../lib/auth";
import { applyTheme, currentTheme, resolvedTheme } from "../lib/theme";
import { Avatar } from "./Avatar";
import { Logo } from "./Logo";
import { Popover } from "./Popover";

const BUCKETS: HistoryBucket[] = ["Today", "Yesterday", "This week", "Earlier"];

export function useChats() {
  return useQuery({ queryKey: ["chats"], queryFn: api.chats, staleTime: 15_000 });
}

function HistoryRow({ chat, active }: { chat: ChatListItem; active: boolean }) {
  const name = chat.character?.name ?? chat.room_name ?? chat.title;
  return (
    <Link
      to={`/chat/${chat.id}`}
      aria-current={active ? "page" : undefined}
      className={clsx(
        "flex items-center gap-2.5 rounded-control px-2 py-1.5 transition-colors duration-150",
        active ? "bg-surface-2 text-ink" : "text-ink-2 hover:bg-surface hover:text-ink",
      )}
    >
      {chat.room_id ? (
        <span className="relative size-8 shrink-0">
          {chat.room_avatars.slice(0, 2).map((a, i) => (
            <Avatar
              key={i}
              src={a}
              name={name}
              size={22}
              ring
              className={clsx("absolute", i === 0 ? "top-0 left-0" : "bottom-0 right-0")}
            />
          ))}
          {!chat.room_avatars.length && <Users size={18} className="m-1.5" />}
        </span>
      ) : (
        <Avatar src={chat.character?.avatar_url} name={name} size={32} />
      )}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{name}</span>
        {chat.last_message && (
          <span className="block truncate text-xs text-ink-3">{chat.last_message}</span>
        )}
      </span>
    </Link>
  );
}

function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const user = useUser();
  const { logout } = useAuth();
  const { chatId } = useParams();
  const { data: chats, isLoading } = useChats();
  const [filter, setFilter] = useState("");
  const navigate = useNavigate();
  const [theme, setTheme] = useState(resolvedTheme(currentTheme()));

  const grouped = useMemo(() => {
    const f = filter.trim().toLowerCase();
    const list = (chats ?? []).filter(
      (c) => !f || (c.character?.name ?? c.room_name ?? c.title).toLowerCase().includes(f),
    );
    const out = new Map<HistoryBucket, ChatListItem[]>();
    for (const c of list) {
      const b = historyBucket(c.updated_at);
      out.set(b, [...(out.get(b) ?? []), c]);
    }
    return out;
  }, [chats, filter]);

  const toggleTheme = () => {
    const next = theme === "dark" ? "light" : "dark";
    applyTheme(next);
    setTheme(next);
    void api.updateMe({ preferences: { theme: next } }).catch(() => {});
  };

  return (
    <nav
      className="flex h-full flex-col bg-panel"
      aria-label="Main"
      onClick={(e) => {
        if ((e.target as HTMLElement).closest("a")) onNavigate?.();
      }}
    >
      <div className="flex items-center justify-between px-4 pt-4 pb-3">
        <Link to="/" aria-label="Persona.AI home">
          <Logo />
        </Link>
      </div>
      <div className="px-3 space-y-1">
        <Link to="/create" className="btn-primary w-full justify-start">
          <Plus size={18} /> Create
        </Link>
        <NavLink
          to="/"
          end
          className={({ isActive }) =>
            clsx("btn-ghost w-full justify-start", isActive && "bg-surface-2 text-ink")
          }
        >
          <Compass size={18} /> Discover
        </NavLink>
        <NavLink
          to="/rooms/new"
          className={({ isActive }) =>
            clsx("btn-ghost w-full justify-start", isActive && "bg-surface-2 text-ink")
          }
        >
          <Users size={18} /> New room
        </NavLink>
      </div>

      <div className="px-3 pt-4 pb-2">
        <label className="relative block">
          <span className="sr-only">Search chats</span>
          <Search
            size={15}
            className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-3"
            aria-hidden="true"
          />
          <input
            className="field h-9 py-0 pl-8 text-sm bg-surface"
            placeholder="Search chats"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
        </label>
      </div>

      <div className="flex-1 overflow-y-auto scroll-thin px-2 pb-2">
        {isLoading &&
          Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="flex items-center gap-2.5 px-2 py-1.5">
              <div className="skeleton size-8 rounded-full" />
              <div className="skeleton h-3 flex-1 rounded" />
            </div>
          ))}
        {!isLoading && !chats?.length && (
          <p className="px-3 py-6 text-sm text-ink-3">
            Your conversations will show up here. Pick a character from Discover to start one.
          </p>
        )}
        {BUCKETS.filter((b) => grouped.get(b)?.length).map((b) => (
          <section key={b} className="mt-2">
            <h2 className="px-2 py-1 text-xs font-semibold text-ink-3">{b}</h2>
            {grouped.get(b)!.map((c) => (
              <HistoryRow key={c.id} chat={c} active={c.id === chatId} />
            ))}
          </section>
        ))}
      </div>

      <div className="border-t border-line p-2">
        <Popover
          side="top"
          align="start"
          label="Account menu"
          trigger={(p) => (
            <button
              {...p}
              className="flex w-full items-center gap-2.5 rounded-control p-2 hover:bg-surface text-left"
            >
              <Avatar src={user.avatar_url} name={user.display_name || user.username} size={32} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold">
                  {user.display_name || user.username}
                </span>
                <span className="block truncate text-xs text-ink-3">@{user.username}</span>
              </span>
            </button>
          )}
        >
          {(close) => (
            <>
              <button
                className="menu-item"
                onClick={() => {
                  close();
                  navigate(`/u/${user.username}`);
                  onNavigate?.();
                }}
              >
                <UserRound size={16} /> Profile
              </button>
              <button
                className="menu-item"
                onClick={() => {
                  close();
                  navigate("/settings");
                  onNavigate?.();
                }}
              >
                <Settings size={16} /> Settings
              </button>
              {user.is_admin && (
                <button
                  className="menu-item"
                  onClick={() => {
                    close();
                    navigate("/admin");
                    onNavigate?.();
                  }}
                >
                  <Shield size={16} /> Admin
                </button>
              )}
              <button className="menu-item" onClick={toggleTheme}>
                {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
                {theme === "dark" ? "Light mode" : "Dark mode"}
              </button>
              <div className="my-1 border-t border-line" />
              <button
                className="menu-item text-err"
                onClick={() => {
                  close();
                  void logout();
                }}
              >
                <LogOut size={16} /> Log out
              </button>
            </>
          )}
        </Popover>
      </div>
    </nav>
  );
}

export function AppShell() {
  const [drawer, setDrawer] = useState(false);
  const loc = useLocation();
  const inChat = loc.pathname.startsWith("/chat/");

  useEffect(() => setDrawer(false), [loc.pathname]);

  return (
    <div className="flex h-dvh overflow-hidden">
      <aside className="hidden md:block w-72 shrink-0 border-r border-line">
        <Sidebar />
      </aside>

      {/* mobile drawer */}
      <div
        className={clsx(
          "md:hidden fixed inset-0 z-(--z-drawer) transition-opacity duration-200",
          drawer ? "opacity-100" : "opacity-0 pointer-events-none",
        )}
        aria-hidden={!drawer}
      >
        <div className="absolute inset-0 bg-black/55" onClick={() => setDrawer(false)} />
        <aside
          className={clsx(
            "absolute inset-y-0 left-0 w-[min(84vw,320px)] transition-transform duration-200 ease-out-quart",
            drawer ? "translate-x-0" : "-translate-x-full",
          )}
          inert={!drawer}
        >
          <button
            className="icon-btn absolute right-2 top-3 z-10"
            onClick={() => setDrawer(false)}
            aria-label="Close menu"
          >
            <X size={18} />
          </button>
          <Sidebar onNavigate={() => setDrawer(false)} />
        </aside>
      </div>

      <main className="flex-1 min-w-0 flex flex-col">
        {!inChat && (
          <header className="md:hidden sticky top-0 z-(--z-sticky) flex items-center gap-2 bg-bg/95 px-2 h-14 border-b border-line">
            <button
              className="icon-btn size-11"
              onClick={() => setDrawer(true)}
              aria-label="Open menu"
            >
              <Menu size={20} />
            </button>
            <Link to="/" aria-label="Persona.AI home">
              <Logo />
            </Link>
            <Link to="/create" className="ml-auto icon-btn size-11" aria-label="Create character">
              <Plus size={20} />
            </Link>
          </header>
        )}
        <div className="flex-1 min-h-0 overflow-y-auto scroll-thin" id="main-scroll">
          <Outlet context={{ openDrawer: () => setDrawer(true) }} />
        </div>
      </main>
    </div>
  );
}

export interface ShellContext {
  openDrawer: () => void;
}
