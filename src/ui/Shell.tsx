import { useEffect, useState, type ReactNode } from 'react';
import { Lockup } from './Lockup';

export const NAV = [
  { path: '/swap', label: 'swap' },
  { path: '/track', label: 'where is my money' },
  { path: '/how', label: 'how it works' },
  { path: '/agent', label: 'agent' },
  { path: '/builders', label: 'builders' },
  { path: '/about', label: 'about' },
] as const;

type Theme = 'dark' | 'light';
const KEY = 'strom-theme';

function savedTheme(): Theme {
  try { return localStorage.getItem(KEY) === 'light' ? 'light' : 'dark'; } catch { return 'dark'; }
}

function useTheme() {
  const [theme, setTheme] = useState<Theme>(savedTheme);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#07080A' : '#F7F6F2');
    try { localStorage.setItem(KEY, theme); } catch { /* private mode: theme still applies for this visit */ }
  }, [theme]);
  return [theme, () => setTheme(t => (t === 'dark' ? 'light' : 'dark'))] as const;
}

const Sun = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="square" aria-hidden="true">
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
  </svg>
);
const Moon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="square" aria-hidden="true">
    <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" />
  </svg>
);

export function Shell({ path, children }: { path: string; children: ReactNode }) {
  const [theme, toggle] = useTheme();
  const next = theme === 'dark' ? 'light' : 'dark';
  // on the mobile swipe strip, keep the current page's link in view
  useEffect(() => {
    document.querySelector('.nav a[aria-current="page"]')?.scrollIntoView({ block: 'nearest', inline: 'center' });
  }, [path]);
  return (
    <div className="shell">
      <header className="bar">
        <Lockup />
        <nav className="nav" aria-label="main">
          {NAV.map(n => (
            <a key={n.path} href={'#' + n.path} aria-current={path === n.path ? 'page' : undefined}>{n.label}</a>
          ))}
        </nav>
        <div className="tools">
          <button className="icon-btn" onClick={toggle} aria-label={`switch to ${next} mode`} title={`${next} mode`}>
            {theme === 'dark' ? <Sun /> : <Moon />}
          </button>
        </div>
      </header>
      <div className="page">{children}</div>
      <footer className="foot">
        <div className="foot-in">
          <span>strom by seedless · you sign every move in your wallet</span>
          <a href="https://seedlesslabs.xyz" target="_blank" rel="noreferrer">seedlesslabs.xyz</a>
        </div>
      </footer>
    </div>
  );
}
