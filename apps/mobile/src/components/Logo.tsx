import Svg, { Circle, Path, Rect } from "react-native-svg";

/** Persona.AI mark (same geometry as apps/web/public/favicon.svg). */
export function Logo({ size = 40 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 64 64" accessibilityLabel="Persona.AI">
      <Rect width={64} height={64} rx={16} fill="#1b1a2b" />
      <Path
        d="M14 18a8 8 0 0 1 8-8h20a8 8 0 0 1 8 8v16a8 8 0 0 1-8 8H30l-9 8v-8h1a8 8 0 0 1-8-8z"
        fill="#ff7a55"
      />
      <Circle cx={27} cy={26} r={7} fill="#1b1a2b" />
      <Circle cx={37} cy={26} r={7} fill="none" stroke="#1b1a2b" strokeWidth={3} />
    </Svg>
  );
}
