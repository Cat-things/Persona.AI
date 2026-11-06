import type { Character } from "@persona/shared";
import { GenerateAvatarButton } from "../components/AvatarGenerator";

/** Extension slots for the character editor. */
export const EditorExtras = {
  ImportButton: (_: { onImported: (c: Character) => void }) => null,
  GenerateAvatar: GenerateAvatarButton,
  VoicePicker: (_: { value: string | null; onChange: (v: string | null) => void }) => null,
};
