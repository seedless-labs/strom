// shared building blocks for the content pages: a hero, numbered sections, a 3-col grid, a closing call.
import type { ReactNode } from 'react';

export function Page({ children }: { children: ReactNode }) {
  return <article className="prose">{children}</article>;
}

export function Hero({ kicker, title, children, cta }: { kicker?: string; title: ReactNode; children?: ReactNode; cta?: ReactNode }) {
  return (
    <header className="hero">
      {kicker && <span className="label">{kicker}</span>}
      <h1 className="h1">{title}</h1>
      {children && <p className="lede">{children}</p>}
      {cta && <div className="ctas">{cta}</div>}
    </header>
  );
}

export function Section({ n, kicker, title, children }: { n?: string; kicker: string; title: ReactNode; children?: ReactNode }) {
  return (
    <section className="sect">
      <span className="label">{n ? `${n} / ` : ''}{kicker}</span>
      <h2 className="h2">{title}</h2>
      {children}
    </section>
  );
}

export type Col = { k?: string; title: string; body: ReactNode; link?: { href: string; label: string } };

export function Cols({ items }: { items: Col[] }) {
  return (
    <div className="cols">
      {items.map(c => (
        <div key={c.title} className="col">
          {c.k && <span className="label">{c.k}</span>}
          <h3>{c.title}</h3>
          <p>{c.body}</p>
          {c.link && <Go href={c.link.href}>{c.link.label}</Go>}
        </div>
      ))}
    </div>
  );
}

/** a text link; external links open in a new tab and say so with ↗ */
export function Go({ href, children }: { href: string; children: ReactNode }) {
  const ext = /^https?:/.test(href);
  return ext
    ? <a className="go" href={href} target="_blank" rel="noreferrer">{children} ↗</a>
    : <a className="go" href={href}>{children} →</a>;
}

export function Cta({ href, ghost, children }: { href: string; ghost?: boolean; children: ReactNode }) {
  return <a className={'btn small' + (ghost ? ' ghost' : '')} href={href}>{children}</a>;
}
