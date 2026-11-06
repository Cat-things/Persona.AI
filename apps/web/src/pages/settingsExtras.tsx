import { api } from "../lib/api";
import { useAuth, useUser } from "../lib/auth";
import { useCaps } from "../lib/voice";
import { Section } from "./Settings";

function VoiceSettings() {
  const user = useUser();
  const { setUser } = useAuth();
  const caps = useCaps();
  if (!caps.data?.tts) return null;
  const on = !!user.preferences.autoplay_voice;
  return (
    <Section title="Voice" description="Characters can read their replies aloud.">
      <label className="flex items-center gap-3 cursor-pointer">
        <input
          type="checkbox"
          className="size-4 accent-[var(--ember)]"
          checked={on}
          onChange={async () =>
            setUser(await api.updateMe({ preferences: { autoplay_voice: !on } }))
          }
        />
        <span className="text-sm">Auto-play new replies</span>
      </label>
    </Section>
  );
}

/** Extension slots for the settings page. */
export const SettingsExtras = {
  Personas: () => null,
  Voice: VoiceSettings,
};
