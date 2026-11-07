import { useColorScheme } from "react-native";
import { create, useStore } from "./store";

/** Same tokens as the web app (apps/web/src/index.css), converted from OKLCH to sRGB hex. */
export const palettes = {
  dark: {
    bg: "#0d0f17",
    panel: "#131520",
    surface: "#1b1d2a",
    surface2: "#252836",
    line: "#2f323e",
    ink: "#edeef4",
    ink2: "#b4b7c1",
    ink3: "#8f929c",
    ember: "#fb794a",
    emberHover: "#ff9164",
    emberInk: "#1f0f09",
    emberSoft: "#fb794a24",
    userBubble: "#292e4a",
    ok: "#5ccb89",
    warn: "#eebc4a",
    err: "#fa6863",
    star: "#fabb41",
    scrim: "#000000aa",
  },
  light: {
    bg: "#f9fafd",
    panel: "#eef0f6",
    surface: "#ffffff",
    surface2: "#e6e7ef",
    line: "#d5d7e0",
    ink: "#181a24",
    ink2: "#4a4c58",
    ink3: "#656875",
    ember: "#d9480f",
    emberHover: "#c83500",
    emberInk: "#ffffff",
    emberSoft: "#d9480f1a",
    userBubble: "#dae0f9",
    ok: "#00884b",
    warn: "#b07100",
    err: "#cc272e",
    star: "#dc8900",
    scrim: "#00000066",
  },
} as const;

export type Colors = { [K in keyof (typeof palettes)["dark"]]: string };

export const font = {
  regular: "Figtree_400Regular",
  medium: "Figtree_500Medium",
  semibold: "Figtree_600SemiBold",
  bold: "Figtree_700Bold",
  extrabold: "Figtree_800ExtraBold",
} as const;

export const radius = { control: 10, card: 16, bubble: 22, pill: 999 } as const;

export type ThemePref = "dark" | "light" | "system";

/** Dark is the default, like the web app. "system" follows the OS. */
export const themePref = create<ThemePref>("dark");

export function useTheme() {
  const pref = useStore(themePref);
  const os = useColorScheme();
  const scheme = pref === "system" ? (os === "light" ? "light" : "dark") : pref;
  return { c: palettes[scheme] as Colors, scheme, font, radius };
}
