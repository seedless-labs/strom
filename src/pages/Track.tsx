// where is my money. takes ?sig= (solana -> near) or ?deposit= (near -> solana) from the link,
// else the last transfer this browser made. polls until it lands or fails. reads only, never signs.
import { useEffect, useState } from 'react';
import { trackToNear, trackToSol, short, TO_NEAR_STEPS, TO_SOL_STEPS } from '../lib/flow';
import { LAST } from './Swap';

type Job = { kind: 'sig' | 'deposit'; id: string };
type State = { done: number; words: string; failed: boolean; solTx?: string };
const POLL_MS = 5000;

function fromLink(): Job | undefined {
  const qs = new URLSearchParams(location.hash.split('?')[1] ?? '');
  const sig = qs.get('sig'), deposit = qs.get('deposit');
  if (sig) return { kind: 'sig', id: sig };
  if (deposit) return { kind: 'deposit', id: deposit };
  try {
    const last = JSON.parse(localStorage.getItem(LAST) ?? 'null');
    if (last?.sig) return { kind: 'sig', id: last.sig };
    if (last?.deposit) return { kind: 'deposit', id: last.deposit };
  } catch { /* nothing saved */ }
}

// a solana signature is 86-88 base58 chars; a 1click deposit address is a 64-char hex near account
const guess = (s: string): Job => ({ kind: /^[1-9A-HJ-NP-Za-km-z]{80,90}$/.test(s) ? 'sig' : 'deposit', id: s });

export default function Track() {
  const [job, setJob] = useState<Job | undefined>(fromLink);
  const [st, setSt] = useState<State>();
  const [err, setErr] = useState('');
  const [paste, setPaste] = useState('');

  // same page, new id in the link: follow it
  useEffect(() => {
    const on = () => setJob(j => { const n = fromLink(); return n && j && n.id === j.id ? j : n; });
    addEventListener('hashchange', on);
    return () => removeEventListener('hashchange', on);
  }, []);

  useEffect(() => {
    if (!job) return;
    let stop = false, timer: ReturnType<typeof setTimeout>;
    setSt(undefined); setErr('');
    const tick = async () => {
      try {
        const s: State = job.kind === 'sig' ? { ...(await trackToNear(job.id)), failed: false } : await trackToSol(job.id);
        if (stop) return;
        setSt(s); setErr('');
        if (s.done >= 4 || s.failed) return;
      } catch (e: any) {
        if (stop) return;
        setErr('could not reach the network, trying again. ' + String(e?.message ?? e).toLowerCase());
      }
      timer = setTimeout(tick, POLL_MS);
    };
    tick();
    return () => { stop = true; clearTimeout(timer); };
  }, [job]);

  const steps = job?.kind === 'deposit' ? TO_SOL_STEPS : TO_NEAR_STEPS;
  const finished = !!st && st.done >= 4;
  const cls = (i: number) => !st ? '' : i < st.done ? 'done' : i === st.done ? (st.failed ? 'fail' : 'live') : '';

  const look = (e: React.FormEvent) => {
    e.preventDefault();
    const v = paste.trim();
    if (!v) return;
    const j = guess(v);
    location.hash = `#/track?${j.kind}=${j.id}`; // hashchange sets the job
    setPaste('');
  };

  return (
    <section className="app">
      <h1 className="h2">where is my money</h1>

      {job ? <>
        <div className="box-head">
          <span className="label">{job.kind === 'sig' ? 'solana → near' : 'near → solana'}</span>
          <span className="label" title={job.id}>{short(job.id)}</span>
        </div>
        <ol className="steps" aria-live="polite">
          {steps.map((s, i) => (
            <li key={s} className={cls(i)}><span className="sq" />{s}<span>{cls(i) === 'done' ? 'done' : cls(i) === 'live' ? 'now' : ''}</span></li>
          ))}
        </ol>
        <p>{st ? st.words : 'looking it up'}</p>
        {st?.failed && <p className="err">this did not go through. 1click sends refunds back to the account it came from.</p>}
        {err && <p className="err" role="alert">{err}</p>}
        <dl className="facts">
          {job.kind === 'sig'
            ? <><dt>solana tx</dt><dd><a href={`https://solscan.io/tx/${job.id}`} target="_blank" rel="noreferrer">view on solscan</a></dd></>
            : <><dt>deposit</dt><dd><a href={`https://explorer.near-intents.org/transactions/${job.id}`} target="_blank" rel="noreferrer">view on near intents</a></dd>
               {st?.solTx && <><dt>solana tx</dt><dd><a href={`https://solscan.io/tx/${st.solTx}`} target="_blank" rel="noreferrer">view on solscan</a></dd></>}</>}
        </dl>
        {finished && <a className="btn" href="#/swap" style={{ display: 'grid', placeItems: 'center', textDecoration: 'none' }}>swap again</a>}
      </> : <p>no transfer yet. paste a solana tx or a 1click deposit address below, or start a swap.</p>}

      <form onSubmit={look} style={{ display: 'grid', gap: 8 }}>
        <label className="label" htmlFor="paste">look up another transfer</label>
        <div className="field"><input id="paste" value={paste} onChange={e => setPaste(e.target.value)} placeholder="solana tx or deposit address" autoComplete="off" spellCheck={false} /></div>
        <button className="btn ghost" disabled={!paste.trim()}>look it up</button>
      </form>
    </section>
  );
}
