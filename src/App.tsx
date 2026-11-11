// routes only. hash router so the static pwa needs no server rewrites.
import { useEffect, useState } from 'react';
import { Shell, NAV } from './ui/Shell';
import Swap from './pages/Swap';
import Track from './pages/Track';
import Home from './pages/Home';
import How from './pages/How';
import About from './pages/About';
import Builders from './pages/Builders';

const route = () => (location.hash.replace(/^#/, '') || '/').split('?')[0];

function Soon({ title }: { title: string }) {
  return (
    <section className="app">
      <h1 className="h2">{title}</h1>
      <p>this page is being written. the swap works today.</p>
      <a className="btn" href="#/swap" style={{ display: 'grid', placeItems: 'center', textDecoration: 'none' }}>go to swap</a>
    </section>
  );
}

export default function App() {
  const [path, setPath] = useState(route);
  useEffect(() => {
    const on = () => { setPath(route()); window.scrollTo(0, 0); };
    addEventListener('hashchange', on);
    return () => removeEventListener('hashchange', on);
  }, []);

  const page = path === '/' ? <Home />
    : path === '/swap' ? <Swap />
    : path === '/track' ? <Track />
    : path === '/how' ? <How />
    : path === '/about' ? <About />
    : path === '/builders' ? <Builders />
    : <Soon title={NAV.find(n => n.path === path)?.label ?? 'page not found'} />;

  return <Shell path={path}>{page}</Shell>;
}
