// "strom by seedless" lockup. the seedless mark is drawn in currentColor so it stays black or white with the theme.
export function SeedlessMark({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="44 64 212 190" fill="currentColor" aria-hidden="true">
      <rect x="52" y="72" width="158" height="34" rx="17" />
      <rect x="52" y="72" width="46" height="84" rx="26" />
      <rect x="52" y="114" width="196" height="98" rx="30" />
      <path d="M166 228l46-12a8 8 0 0 1 4 15l-44 11a8 8 0 0 1-6-14z" />
    </svg>
  );
}

export function Lockup({ href = '#/' }: { href?: string }) {
  return (
    <a className="lockup" href={href} aria-label="strom by seedless, home">
      <b>strom</b>
      <small>by <SeedlessMark /> seedless</small>
    </a>
  );
}
