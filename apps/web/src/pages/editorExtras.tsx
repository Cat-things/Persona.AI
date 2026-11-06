import type { Character } from "@persona/shared";
import { GenerateAvatarButton } from "../components/AvatarGenerator";
import { VoicePicker } from "../components/VoicePicker";

/** Extension slots for the character editor. */
export const EditorExtras = {
  ImportButton: (_: { onImported: (c: Character) => void }) => null,
  GenerateAvatar: GenerateAvatarButton,
  VoicePicker,
};
