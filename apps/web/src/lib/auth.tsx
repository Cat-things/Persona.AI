import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { InstanceConfig, UserMe } from "@persona/shared";
import { api, chatSocket } from "./api";
import { applyTheme } from "./theme";

interface AuthState {
  user: UserMe | null;
  config: InstanceConfig | null;
  loading: boolean;
  setUser: (u: UserMe | null) => void;
  logout: () => Promise<void>;
  refreshConfig: () => Promise<void>;
}

const Ctx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<UserMe | null>(null);
  const [config, setConfig] = useState<InstanceConfig | null>(null);
  const [loading, setLoading] = useState(true);

  const refreshConfig = useCallback(async () => {
    try {
      setConfig(await api.config());
    } catch {
      setConfig(null);
    }
  }, []);

  useEffect(() => {
    api.onUserChange = (u) => setUser(u);
    (async () => {
      await refreshConfig();
      const u = await api.restore();
      setUser(u);
      setLoading(false);
    })();
  }, [refreshConfig]);

  useEffect(() => {
    if (user?.preferences?.theme) applyTheme(user.preferences.theme);
    if (user) void chatSocket.connect();
    else chatSocket.close();
  }, [user]);

  const logout = useCallback(async () => {
    await api.logout();
    chatSocket.close();
    setUser(null);
  }, []);

  const value = useMemo(
    () => ({ user, config, loading, setUser, logout, refreshConfig }),
    [user, config, loading, logout, refreshConfig],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAuth outside provider");
  return v;
}

export function useUser(): UserMe {
  const { user } = useAuth();
  if (!user) throw new Error("useUser requires a signed-in user");
  return user;
}
