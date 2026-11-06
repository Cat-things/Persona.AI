import { useState, type FormEvent } from "react";
import { Link, Navigate, useNavigate, useSearchParams } from "react-router";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { errorText } from "../lib/toast";
import { LogoMark } from "../components/Logo";

export function AuthPage({ mode }: { mode: "login" | "register" }) {
  const { user, config, setUser, refreshConfig } = useAuth();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [email, setEmail] = useState("");
  const [invite, setInvite] = useState(params.get("invite") ?? "");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const setup = !!config?.needs_setup;
  const isRegister = mode === "register" || setup;
  if (user) return <Navigate to={params.get("next") || "/"} replace />;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      const u = isRegister
        ? await api.register(username.trim(), password, {
            email: email.trim() || undefined,
            invite_code: invite.trim() || undefined,
          })
        : await api.login(username.trim(), password);
      setUser(u);
      await refreshConfig();
      navigate(setup ? "/admin?welcome=1" : params.get("next") || "/", { replace: true });
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  const title = setup
    ? "Set up your instance"
    : isRegister
      ? "Create your account"
      : "Welcome back";
  const regClosed = isRegister && config && !config.registration_open;

  return (
    <div className="min-h-dvh grid place-items-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center text-center mb-8">
          <LogoMark size={48} />
          <h1 className="text-2xl font-bold mt-4">{title}</h1>
          <p className="text-ink-2 mt-1.5 text-sm">
            {setup
              ? "The first account becomes the administrator of this server."
              : `${config?.instance_name ?? "Persona.AI"}: chat with characters, on your own server.`}
          </p>
        </div>
        {regClosed ? (
          <p className="rounded-card bg-surface p-4 text-sm text-ink-2">
            Registration is closed on this instance. Ask the administrator for an account.
          </p>
        ) : (
          <form onSubmit={submit} className="space-y-4" noValidate>
            <div>
              <label className="label" htmlFor="username">
                Username
              </label>
              <input
                id="username"
                className="field"
                autoComplete="username"
                autoCapitalize="none"
                required
                value={username}
                onChange={(e) => setUsername(e.target.value)}
              />
              {isRegister && <p className="hint">3 to 32 letters, digits or underscores.</p>}
            </div>
            {isRegister && (
              <div>
                <label className="label" htmlFor="email">
                  Email <span className="font-normal text-ink-3">(optional)</span>
                </label>
                <input
                  id="email"
                  type="email"
                  className="field"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
            )}
            <div>
              <label className="label" htmlFor="password">
                Password
              </label>
              <input
                id="password"
                type="password"
                className="field"
                autoComplete={isRegister ? "new-password" : "current-password"}
                required
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              {isRegister && <p className="hint">At least 8 characters.</p>}
            </div>
            {isRegister && config?.invite_only && !setup && (
              <div>
                <label className="label" htmlFor="invite">
                  Invite code
                </label>
                <input
                  id="invite"
                  className="field"
                  required
                  value={invite}
                  onChange={(e) => setInvite(e.target.value)}
                />
              </div>
            )}
            {error && (
              <p role="alert" className="text-sm text-err">
                {error}
              </p>
            )}
            <button className="btn-primary w-full h-11" disabled={busy || !username || !password}>
              {busy
                ? "Please wait…"
                : setup
                  ? "Create admin account"
                  : isRegister
                    ? "Create account"
                    : "Log in"}
            </button>
          </form>
        )}
        {!setup && (
          <p className="text-center text-sm text-ink-2 mt-6">
            {isRegister ? (
              <>
                Already have an account?{" "}
                <Link className="text-ember font-semibold hover:underline" to="/login">
                  Log in
                </Link>
              </>
            ) : (
              config?.registration_open && (
                <>
                  New here?{" "}
                  <Link className="text-ember font-semibold hover:underline" to="/register">
                    Create an account
                  </Link>
                </>
              )
            )}
          </p>
        )}
      </div>
    </div>
  );
}
