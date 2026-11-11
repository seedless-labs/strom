// agent: plain words in, a ready swap out. it reads and suggests; it never signs and never sends.
// the answer is a link into the swap or track page, where your wallet still approves every move.
import { useState } from 'react';
import { Page, Hero, Section, Cta } from '../ui/Prose';
import { understand, href, type Intent } from '../lib/agent';

const SAY = [
  'swap 10 usdc to near',
  'move all my sol to near',
  'how much near do i get for 50 usdc?',
  'where is my money?',
];

function Card({ i }: { i: Intent }) {
  const go = href(i);
  const amt = i.amt === 'max' ? 'all of it' : i.amt || 'not said';
  return (
    <div className="box" aria-live="polite">
      {i.kind === 'track' ? <p>{i.note || 'opening your last transfer.'}</p> : i.kind === 'unknown' ? <p className="err">{i.note || 'say an amount and a token, like "swap 10 usdc to near".'}</p> : <>
        <dl className="facts">
          <dt>{i.kind === 'quote' ? 'quote' : 'swap'}</dt><dd>{i.dir === 'to-near' ? `${i.tok} → near` : 'near → sol'}</dd>
          <dt>amount</dt><dd>{amt}</dd>
          <dt>route</dt><dd>{i.dir === 'to-near' ? 'jupiter, omni bridge, near intents' : 'near intents, 1click'}</dd>
        </dl>
        {i.note && <p>{i.note}</p>}
        <p className="label">nothing moves until you approve it in your wallet.</p>
      </>}
      {go && <a className="btn" href={go} style={{ display: 'grid', placeItems: 'center', textDecoration: 'none' }}>{i.kind === 'track' ? 'open tracker' : 'open in swap'}</a>}
    </div>
  );
}

export default function Agent() {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<Intent>();

  const ask = async (words: string) => {
    if (!words.trim()) return;
    setText(words); setBusy(true); setRes(undefined);
    try { setRes(await understand(words)); } finally { setBusy(false); }
  };

  return (
    <Page>
      <Hero kicker="agent" title={<>it reads. <span className="acc">you approve.</span></>}>
        say what you want in plain words. strom turns it into a ready swap and hands it to the swap page.
        it can never move money on its own. your wallet approves every move.
      </Hero>

      <Section n="01" kicker="tell strom" title="plain words in, a ready swap out.">
        <form onSubmit={e => { e.preventDefault(); ask(text); }} style={{ display: 'grid', gap: 8 }}>
          <label className="label" htmlFor="say">what do you want to do</label>
          <div className="field">
            <input id="say" value={text} maxLength={200} onChange={e => setText(e.target.value)} placeholder="swap 10 usdc to near" autoComplete="off" spellCheck={false} />
          </div>
          <button className="btn" disabled={busy || !text.trim()}>{busy ? 'reading' : 'read it'}</button>
        </form>
        <div className="ctas">
          {SAY.map(s => <button key={s} type="button" className="btn small ghost" onClick={() => ask(s)}>{s}</button>)}
        </div>
        {res && <Card i={res} />}
      </Section>

      <Section n="02" kicker="what it can and cannot do" title="read only. always.">
        <div className="vs">
          <ul className="yes">
            <li>turn plain words into a ready swap</li>
            <li>open the tracker on your last transfer</li>
            <li>refuse tokens strom does not move</li>
            <li>show the route before you approve</li>
          </ul>
          <ul className="no">
            <li>hold your keys or your money</li>
            <li>approve anything for you</li>
            <li>send money without your wallet</li>
            <li>guess a token it cannot verify</li>
          </ul>
        </div>
      </Section>

      <Section kicker="seedless" title="or do it by hand.">
        <div className="ctas"><Cta href="#/swap">start a swap</Cta><Cta href="#/track" ghost>track a transfer</Cta></div>
      </Section>
    </Page>
  );
}
