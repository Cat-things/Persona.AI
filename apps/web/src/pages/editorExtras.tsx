import type { Character } from "@persona/shared";
import { FileUp, Loader2 } from "lucide-react";
import { useRef, useState } from "react";
import { GenerateAvatarButton } from "../components/AvatarGenerator";
import { VoicePicker } from "../components/VoicePicker";
import { api } from "../lib/api";
import { errorText, useToast } from "../lib/toast";

/** Import a Character Card (V1/V2/V3, .json or .png). Imports start private. */
function ImportButton({ onImported }: { onImported: (c: Character) => void }) {
  const file = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  return (
    <>
      <input
        ref={file}
        type="file"
        accept=".json,.png,application/json,image/png"
        className="hidden"
        onChange={async (e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (!f) return;
          setBusy(true);
          try {
            const c = await api.importCard(f);
            toast(`Imported ${c.name} as private. Review it, then publish.`, "success");
            onImported(c);
          } catch (err) {
            toast(errorText(err), "error");
          } finally {
            setBusy(false);
          }
        }}
      />
      <button
        type="button"
        className="btn-secondary shrink-0"
        disabled={busy}
        onClick={() => file.current?.click()}
        title="SillyTavern / TavernAI character card, .json or .png"
      >
        {busy ? <Loader2 size={16} className="animate-spin" /> : <FileUp size={16} />} Import card
      </button>
    </>
  );
}

/** Extension slots for the character editor. */
export const EditorExtras = {
  ImportButton,
  GenerateAvatar: GenerateAvatarButton,
  VoicePicker,
};
