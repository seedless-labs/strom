// swap board from canvas v8. one card, one primary action, the wire moves only while money moves.
import { useEffect, useState } from 'react';
import type { Wallet, WalletAccount } from '@wallet-standard/base';
import { solanaWallets, onWalletsChange, connect } from '../wallet';
import {
  quoteToNear, sendToNear, nearBalance, quoteToSol, sendToSol, nearAccountOf,
  fmt, short, DECIMALS, NEAR_DECIMALS, type Tok, type SwapPlan, type Quote,
} from '../lib/flow';

type Dir = 'to-near' | 'to-sol';

// a link from the agent page can prefill the board: #/swap?dir=to-near&tok=sol&amt=max. it never sends.
function fromLink() {
  const qs = new URLSearchParams(location.hash.split('?')[1] ?? '');
  const dir: Dir = qs.get('dir') === 'to-sol' ? 'to-sol' : 'to-near';
  const tok: Tok = qs.get('tok') === 'sol' ? 'sol' : 'usdc';
  const a = qs.get('amt') ?? '';
  return { dir, tok, max: a === 'max', amt: /^\d{1,12}(\.\d{1,9})?$/.test(a) ? a : a === 'max' ? '' : '1' };
}
export const LAST = 'strom-last'; // last transfer, read by the track page

function Wire({ live, dir }: { live: boolean; dir: Dir }) {
  const stops = dir === 'to-near' ? ['solana', 'jupiter', 'omni', 'near'] : ['near', 'intents', '1click', 'solana'];
  return (
    <div>
      <svg className={'wire' + (live ? ' live' : '')} width="100%" height="10" viewBox="0 0 400 10" preserveAspectRatio="none" aria-hidden="true">
        <line x1="0" y1="5" x2="400" y2="5" stroke="var(--line2)" strokeWidth="1" />
        <line x1="0" y1="5" x2="400" y2="5" stroke="var(--acc)" strokeWidth="2" />
      </svg>
      <div className="wire-stops">{stops.map(s => <span key={s}>{s}</span>)}</div>
    </div>
  );
}

export default function Swap() {
  const [wallets, setWallets] = useState<Wallet[]>(solanaWallets);
  const [w, setW] = useState<Wallet>(); const [acct, setAcct] = useState<WalletAccount>();
  const [init] = useState(fromLink);
  const [dir, setDir] = useState<Dir>(init.dir);
  const [tok, setTok] = useState<Tok>(init.tok);
  const [amt, setAmt] = useState(init.amt);
  const [max, setMax] = useState(init.max); // "all of it": filled from the near balance, else the user types it
  const [plan, setPlan] = useState<SwapPlan>(); const [q, setQ] = useState<Quote>();
  const [nearBal, setNearBal] = useState<bigint>();
  const [busy, setBusy] = useState(''); const [err, setErr] = useState('');

  useEffect(() => onWalletsChange(() => setWallets(solanaWallets())), []);
  // any change to what is being sent throws away the old quote
  useEffect(() => { setPlan(undefined); setQ(undefined); setErr(''); }, [dir, tok, amt, acct]);
  useEffect(() => {
    if (!acct || dir !== 'to-sol') return;
    nearBalance(acct.address).then(setNearBal).catch(() => setNearBal(undefined));
  }, [acct, dir]);
  useEffect(() => {
    if (max && dir === 'to-sol' && nearBal !== undefined) { setAmt(fmt(nearBal, NEAR_DECIMALS, 6)); setMax(false); }
  }, [max, dir, nearBal]);

  const run = (label: string, f: () => Promise<void>) => async () => {
    setErr(''); setBusy(label);
    try { await f(); } catch (e: any) { setErr(String(e?.message ?? e).toLowerCase()); } finally { setBusy(''); }
  };
  const pick = (x: Wallet) => run('connecting', async () => { setAcct(await connect(x)); setW(x); })();
  const review = run('getting a quote', async () => {
    if (dir === 'to-near') setPlan(await quoteToNear(acct!.address, tok, amt));
    else setQ(await quoteToSol(acct!.address, amt));
  });
  const sign = run('waiting for your wallet', async () => {
    const save = (v: object) => { try { localStorage.setItem(LAST, JSON.stringify({ ...v, at: Date.now() })); } catch { /* track page also takes it from the link */ } };
    if (dir === 'to-near') {
      const sig = await sendToNear(w!, acct!, plan!, setBusy);
      save({ dir, sig }); location.hash = '#/track?sig=' + sig;
    } else {
      const deposit = await sendToSol(w!, acct!, q!, setBusy);
      save({ dir, deposit }); location.hash = '#/track?deposit=' + deposit;
    }
  });

  const sendTok = dir === 'to-near' ? tok : 'near';
  const get = dir === 'to-near'
    ? (plan ? fmt(plan.bridged - plan.relayFee, DECIMALS.near) : '')
    : (q ? fmt(q.amountOut, DECIMALS.sol) : '');
  const ready = dir === 'to-near' ? !!plan : !!q;
  const amtOk = Number(amt) > 0;

  const primary = !acct ? null
    : !ready ? <button className="btn" disabled={!!busy || !amtOk} onClick={review}>{busy || 'review swap'}</button>
    : <button className="btn" disabled={!!busy} onClick={sign}>{busy || 'sign in your wallet'}</button>;

  return (
    <section className="app">
      <div className="box-head" style={{ alignItems: 'center' }}>
        <span className="h2">swap</span>
        {acct && <span className="token" title={acct.address}>{short(acct.address)}</span>}
      </div>

      <div className="box">
        <div className="box-row">
          <div className="box-head">
            <span className="label">you send · {dir === 'to-near' ? 'solana' : 'near'}</span>
            {dir === 'to-sol' && nearBal !== undefined && (
              <button className="label" style={{ background: 'none', border: 0, cursor: 'pointer' }} onClick={() => setAmt(fmt(nearBal, NEAR_DECIMALS, 6))}>
                balance {fmt(nearBal, NEAR_DECIMALS)}
              </button>
            )}
          </div>
          <div className="amount">
            <input inputMode="decimal" aria-label="amount to send" value={amt} placeholder={max ? 'all' : '0'} onChange={e => { setMax(false); setAmt(e.target.value.replace(/[^0-9.]/g, '')); }} />
            {dir === 'to-near'
              ? <button className="token" onClick={() => setTok(tok === 'usdc' ? 'sol' : 'usdc')} aria-label="change token">{tok} ⇄</button>
              : <span className="token">near</span>}
          </div>
          {max && dir === 'to-near' && <span className="label">type how much {tok} to move. strom does not read your solana balance yet.</span>}
        </div>
        <div className="flip">
          <button className="icon-btn" aria-label="flip direction" onClick={() => setDir(dir === 'to-near' ? 'to-sol' : 'to-near')}>⇅</button>
        </div>
        <div className="box-row">
          <span className="label">you get · {dir === 'to-near' ? 'near' : 'solana'}</span>
          <div className="amount">
            <output aria-live="polite">{get || '—'}</output>
            <span className="token">{dir === 'to-near' ? 'near' : 'sol'}</span>
          </div>
        </div>
      </div>

      <Wire live={!!busy && busy !== 'getting a quote'} dir={dir} />

      <dl className="facts">
        <dt>to</dt><dd>{acct ? `your intents account ${short(nearAccountOf(acct.address))}` : 'your intents account'}</dd>
        {dir === 'to-near' ? <>
          <dt>gas</dt><dd>{plan ? `${fmt(plan.koraFee, DECIMALS.usdc, 2)} usdc · no sol needed` : 'paid in usdc · no sol needed'}</dd>
          <dt>bridge fee</dt><dd>{plan ? `${fmt(plan.relayFee, DECIMALS.near)} near` : 'taken from what you get'}</dd>
          {plan && <><dt>route</dt><dd>{plan.route.toLowerCase()}</dd></>}
        </> : <>
          <dt>gas</dt><dd>none · you sign one message</dd>
          {q?.timeEstimate && <><dt>time</dt><dd>about {q.timeEstimate}s</dd></>}
        </>}
        <dt>signatures</dt><dd>1</dd>
      </dl>

      {err && <p className="err" role="alert">{err}</p>}

      {!acct ? (
        <div style={{ display: 'grid', gap: 8 }}>
          <span className="label">connect your wallet</span>
          {wallets.length
            ? wallets.map((x, i) => <button key={x.name} className={i ? "btn ghost" : "btn"} disabled={!!busy} onClick={() => pick(x)}>{busy || x.name.toLowerCase()}</button>)
            : <p>no solana wallet found in this browser. open strom inside your wallet app, or add a wallet extension.</p>}
        </div>
      ) : primary}
    </section>
  );
}
