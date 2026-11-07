import { api } from "../lib/api";
import { useAuth, useUser } from "../lib/auth";
import { useCaps } from "../lib/voice";
import { PersonaSettings } from "../components/Personas";
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

function TrainingSettings() {
  const user = useUser();
  const { setUser } = useAuth();
  const on = user.preferences.training_opt_in === true;
  return (
    <Section
      title="Help train this instance's model"
      description="Off by default. Only this server's admin can export training data; nothing leaves the server unless they copy it."
    >
      <label className="flex items-start gap-3 cursor-pointer">
        <input
          type="checkbox"
          className="size-4 mt-0.5 accent-[var(--ember)]"
          checked={on}
          onChange={async () =>
            setUser(await api.updateMe({ preferences: { training_opt_in: !on } }))
          }
        />
        <span className="text-sm">
          Let the admin use my rated chats to fine-tune the chat model. Replies you rate 3 or 4
          stars are learned from; your names, emails, phone numbers and links are removed, and
          anything the content filter flags is left out. Chats in rooms are never used.
        </span>
      </label>
    </Section>
  );
}

/** Extension slots for the settings page. */
export const SettingsExtras = {
  Personas: () => <PersonaSettings Section={Section} />,
  Voice: VoiceSettings,
  Training: TrainingSettings,
};
