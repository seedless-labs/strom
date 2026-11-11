// "[mark] strom by seedless" lockup. the seedless mark is drawn in currentColor so it stays black or white with the theme.
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

// strom mark: the wire steps up from one chain to the other. ends follow the text colour, the wire is the accent.
export function StromMark({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      <rect x="6" y="38" width="12" height="12" fill="currentColor" />
      <rect x="46" y="14" width="12" height="12" fill="currentColor" />
      <path d="M18 44H32V20H46" fill="none" stroke="var(--acc)" strokeWidth="5" />
    </svg>
  );
}

export function Lockup({ href = '#/' }: { href?: string }) {
  return (
    <a className="lockup" href={href} aria-label="strom by seedless, home">
      <StromMark />
      <b>strom</b>
      <small>by <SeedlessMark /> seedless</small>
    </a>
  );
}
