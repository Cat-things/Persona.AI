export function LogoMark({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      <path
        d="M10 18a10 10 0 0 1 10-10h24a10 10 0 0 1 10 10v16a10 10 0 0 1-10 10H31l-11 10v-10a10 10 0 0 1-10-10z"
        fill="var(--ember)"
      />
      <circle cx="27" cy="26" r="7.5" fill="var(--bg)" />
      <circle cx="37.5" cy="26" r="7.5" fill="none" stroke="var(--bg)" strokeWidth="3.2" />
    </svg>
  );
}

export function Logo() {
  return (
    <span className="inline-flex items-center gap-2 font-bold text-lg tracking-tight text-ink">
      <LogoMark />
      <span>
        Persona<span className="text-ember">.AI</span>
      </span>
    </span>
  );
}
