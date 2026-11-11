// routes only. hash router so the static pwa needs no server rewrites.
import { useEffect, useState } from 'react';
import { Shell } from './ui/Shell';
import Swap from './pages/Swap';
import Track from './pages/Track';
import Home from './pages/Home';
import How from './pages/How';
import About from './pages/About';
import Builders from './pages/Builders';
import Agent from './pages/Agent';

const route = () => (location.hash.replace(/^#/, '') || '/').split('?')[0];

function NotFound() {
  return (
    <section className="app">
      <h1 className="h2">page not found</h1>
      <p>this link goes nowhere. the swap is one tap away.</p>
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
    : path === '/agent' ? <Agent />
    : <NotFound />;

  return <Shell path={path}>{page}</Shell>;
}
