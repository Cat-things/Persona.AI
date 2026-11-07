import type { InstanceConfig, UserMe } from "@persona/shared";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { api, chatSocket, connect, forgetSession, onUserChange } from "./api";
import { saveServer, savedServer } from "./server";
import { themePref } from "./theme";

interface AuthState {
  booting: boolean;
  server: string | null;
  config: InstanceConfig | null;
  user: UserMe | null;
  setUser: (u: UserMe | null) => void;
  selectServer: (url: string, config: InstanceConfig) => Promise<void>;
  changeServer: () => Promise<void>;
  refreshConfig: () => Promise<void>;
  logout: () => Promise<void>;
}

const Ctx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [booting, setBooting] = useState(true);
  const [server, setServer] = useState<string | null>(null);
  const [config, setConfig] = useState<InstanceConfig | null>(null);
  const [user, setUserState] = useState<UserMe | null>(null);

  const setUser = useCallback((u: UserMe | null) => {
    setUserState(u);
    const t = u?.preferences?.theme;
    if (t === "dark" || t === "light" || t === "system") themePref.set(t);
    if (u) void chatSocket.connect();
    else chatSocket.close();
  }, []);

  useEffect(() => {
    onUserChange(setUser);
  }, [setUser]);

  // Boot: saved server -> try to restore the session. Offline is fine: we still show the app
  // shell and let screens surface "can't reach the server".
  useEffect(() => {
    void (async () => {
      const url = await savedServer();
      if (url) {
        connect(url);
        onUserChange(setUser);
        setServer(url);
        try {
          setConfig(await api.config());
        } catch {
          /* offline; screens will retry */
        }
        setUser(await api.restore());
      }
      setBooting(false);
    })();
  }, [setUser]);

  const value = useMemo<AuthState>(
    () => ({
      booting,
      server,
      config,
      user,
      setUser,
      async selectServer(url, cfg) {
        if (url !== server) {
          await forgetSession();
          setUser(null);
        }
        await saveServer(url);
        connect(url);
        onUserChange(setUser);
        setServer(url);
        setConfig(cfg);
      },
      async changeServer() {
        try {
          if (user) await api.logout();
        } catch {
          /* best effort */
        }
        await forgetSession();
        await saveServer(null);
        setUser(null);
        setServer(null);
        setConfig(null);
      },
      async refreshConfig() {
        setConfig(await api.config());
      },
      async logout() {
        try {
          await api.logout();
        } finally {
          setUser(null);
        }
      },
    }),
    [booting, server, config, user, setUser],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAuth outside AuthProvider");
  return v;
}

/** The signed-in user; only call inside the signed-in part of the app. */
export function useUser(): UserMe {
  const { user } = useAuth();
  if (!user) throw new Error("useUser without a user");
  return user;
}
