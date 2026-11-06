import type { Character, CharacterInput } from "@persona/shared";

/** Extension slots for the character editor. Filled in by later phases. */
export const EditorExtras = {
  ImportButton: (_: { onImported: (c: Character) => void }) => null,
  GenerateAvatar: (_: {
    form: CharacterInput;
    onPick: (url: string) => void;
    characterId?: string;
  }) => null,
  VoicePicker: (_: { value: string | null; onChange: (v: string | null) => void }) => null,
};
