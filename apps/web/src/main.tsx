import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, Navigate, Outlet, RouterProvider, useLocation } from "react-router";
import { AppShell } from "./components/AppShell";
import { LogoMark } from "./components/Logo";
import "./index.css";
import { AuthProvider, useAuth } from "./lib/auth";
import { ToastProvider } from "./lib/toast";
import { AdminPage } from "./pages/Admin";
import { AuthPage } from "./pages/Auth";
import { CharacterEditor } from "./pages/CharacterEditor";
import { CharacterPage } from "./pages/CharacterPage";
import { CharacterStart } from "./pages/CharacterStart";
import { ChatPage } from "./pages/Chat";
import { DiscoverPage } from "./pages/Discover";
import { NotFound } from "./pages/NotFound";
import { ProfilePage } from "./pages/Profile";
import { SettingsPage } from "./pages/Settings";
import { extraRoutes } from "./routes.extra";

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
});

function RequireAuth() {
  const { user, loading, config } = useAuth();
  const loc = useLocation();
  if (loading) {
    return (
      <div className="grid h-dvh place-items-center" role="status" aria-label="Loading">
        <span className="animate-pulse">
          <LogoMark size={44} />
        </span>
      </div>
    );
  }
  if (!user) {
    const to = config?.needs_setup ? "/register" : "/login";
    return <Navigate to={`${to}?next=${encodeURIComponent(loc.pathname + loc.search)}`} replace />;
  }
  return <Outlet />;
}

const router = createBrowserRouter([
  { path: "/login", element: <AuthPage mode="login" /> },
  { path: "/register", element: <AuthPage mode="register" /> },
  ...extraRoutes.public,
  {
    element: <RequireAuth />,
    children: [
      ...extraRoutes.fullscreen,
      {
        element: <AppShell />,
        children: [
          { index: true, element: <DiscoverPage /> },
          { path: "chat/:chatId", element: <ChatPage /> },
          { path: "c/:characterId", element: <CharacterStart /> },
          { path: "character/:characterId", element: <CharacterPage /> },
          { path: "character/:characterId/edit", element: <CharacterEditor /> },
          { path: "create", element: <CharacterEditor /> },
          { path: "u/:username", element: <ProfilePage /> },
          { path: "settings", element: <SettingsPage /> },
          { path: "admin", element: <AdminPage /> },
          ...extraRoutes.shell,
          { path: "*", element: <NotFound /> },
        ],
      },
    ],
  },
]);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <AuthProvider>
          <RouterProvider router={router} />
        </AuthProvider>
      </ToastProvider>
    </QueryClientProvider>
  </StrictMode>,
);
