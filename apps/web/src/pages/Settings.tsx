import { useRef, useState, type ReactNode } from "react";
import { Upload } from "lucide-react";
import { Avatar } from "../components/Avatar";
import { api } from "../lib/api";
import { useAuth, useUser } from "../lib/auth";
import { applyTheme, currentTheme, type Theme } from "../lib/theme";
import { errorText, useToast } from "../lib/toast";
import { SettingsExtras } from "./settingsExtras";

export function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-card bg-surface p-5">
      <h2 className="font-bold">{title}</h2>
      {description && <p className="text-sm text-ink-2 mt-0.5">{description}</p>}
      <div className="mt-4 space-y-4">{children}</div>
    </section>
  );
}

export function SettingsPage() {
  const user = useUser();
  const { setUser } = useAuth();
  const toast = useToast();
  const [displayName, setDisplayName] = useState(user.display_name);
  const [bio, setBio] = useState(user.bio);
  const [email, setEmail] = useState(user.email ?? "");
  const [theme, setTheme] = useState<Theme>(currentTheme());
  const [pw, setPw] = useState({ current: "", next: "" });
  const fileRef = useRef<HTMLInputElement>(null);

  const saveProfile = async (extra: Parameters<typeof api.updateMe>[0] = {}) => {
    try {
      setUser(await api.updateMe({ display_name: displayName, bio, email, ...extra }));
      toast("Saved", "success");
    } catch (e) {
      toast(errorText(e), "error");
    }
  };

  const changeTheme = (t: Theme) => {
    setTheme(t);
    applyTheme(t);
    void api
      .updateMe({ preferences: { theme: t } })
      .then(setUser)
      .catch(() => {});
  };

  const changePassword = async () => {
    try {
      await api.changePassword(pw.current, pw.next);
      setPw({ current: "", next: "" });
      toast("Password changed", "success");
    } catch (e) {
      toast(errorText(e), "error");
    }
  };

  return (
    <div className="mx-auto max-w-2xl px-4 py-8 space-y-5">
      <h1 className="text-2xl font-bold">Settings</h1>
      <Section title="Profile">
        <div className="flex items-center gap-4">
          <Avatar src={user.avatar_url} name={user.display_name || user.username} size={72} />
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="hidden"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              try {
                const { url } = await api.uploadImage(f);
                await saveProfile({ avatar_url: url });
              } catch (err) {
                toast(errorText(err), "error");
              }
            }}
          />
          <button className="btn-secondary" onClick={() => fileRef.current?.click()}>
            <Upload size={16} /> Change photo
          </button>
        </div>
        <div>
          <label className="label" htmlFor="dn">
            Display name
          </label>
          <input
            id="dn"
            className="field"
            value={displayName}
            maxLength={64}
            onChange={(e) => setDisplayName(e.target.value)}
          />
          <p className="hint">Characters call you this unless you pick a persona.</p>
        </div>
        <div>
          <label className="label" htmlFor="bio">
            Bio
          </label>
          <textarea
            id="bio"
            className="field min-h-20"
            value={bio}
            maxLength={2000}
            onChange={(e) => setBio(e.target.value)}
          />
        </div>
        <div>
          <label className="label" htmlFor="email">
            Email
          </label>
          <input
            id="email"
            type="email"
            className="field"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <button className="btn-primary" onClick={() => saveProfile()}>
          Save profile
        </button>
      </Section>

      <SettingsExtras.Personas />

      <Section title="Appearance">
        <div className="flex gap-2" role="radiogroup" aria-label="Theme">
          {(["dark", "light", "system"] as Theme[]).map((t) => (
            <button
              key={t}
              role="radio"
              aria-checked={theme === t}
              className="chip capitalize"
              aria-pressed={theme === t}
              onClick={() => changeTheme(t)}
            >
              {t}
            </button>
          ))}
        </div>
      </Section>

      <SettingsExtras.Voice />

      <Section title="Password">
        <div className="grid sm:grid-cols-2 gap-3">
          <div>
            <label className="label" htmlFor="pw1">
              Current password
            </label>
            <input
              id="pw1"
              type="password"
              className="field"
              autoComplete="current-password"
              value={pw.current}
              onChange={(e) => setPw({ ...pw, current: e.target.value })}
            />
          </div>
          <div>
            <label className="label" htmlFor="pw2">
              New password
            </label>
            <input
              id="pw2"
              type="password"
              className="field"
              autoComplete="new-password"
              minLength={8}
              value={pw.next}
              onChange={(e) => setPw({ ...pw, next: e.target.value })}
            />
          </div>
        </div>
        <button
          className="btn-secondary"
          disabled={!pw.current || pw.next.length < 8}
          onClick={changePassword}
        >
          Change password
        </button>
      </Section>
    </div>
  );
}
