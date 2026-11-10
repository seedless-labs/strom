// chunk-1 test surface: connect your wallet, build the one-signature swap, sign, kora sends, check the bridge.
// the full swap/track screens from canvas v8 land in chunk 3.
import { useEffect, useState } from 'react';
import type { Wallet, WalletAccount } from '@wallet-standard/base';
import { MINTS, DECIMALS, defaultCfg } from './lib/config';
import { buildSwap, type SwapPlan } from './lib/buildSwap';
import { signAndSend } from './lib/kora';
import { transferStatus } from './lib/omni';
import { solanaWallets, onWalletsChange, connect, signWire } from './wallet';

type Tok = 'usdc' | 'sol';
const toBase = (v: string, d: number) => { const [i, f = ''] = v.trim().split('.'); return BigInt(i || '0') * 10n ** BigInt(d) + BigInt((f + '0'.repeat(d)).slice(0, d) || '0'); };
const fmt = (v: bigint, d: number, p = 4) => (Number(v) / 10 ** d).toFixed(p);
const short = (s: string) => `${s.slice(0, 4)}…${s.slice(-4)}`;

export default function App() {
  const [theme, setTheme] = useState<'dark' | 'light'>(() => { try { return (localStorage.getItem('theme') as any) || 'dark'; } catch { return 'dark'; } });
  const [wallets, setWallets] = useState<Wallet[]>(solanaWallets);
  const [w, setW] = useState<Wallet>(); const [acct, setAcct] = useState<WalletAccount>();
  const [tok, setTok] = useState<Tok>('usdc'); const [amt, setAmt] = useState('10');
  const [plan, setPlan] = useState<SwapPlan>(); const [sig, setSig] = useState<string>();
  const [status, setStatus] = useState<string>(); const [busy, setBusy] = useState(''); const [err, setErr] = useState('');

  useEffect(() => { document.documentElement.dataset.theme = theme; try { localStorage.setItem('theme', theme); } catch {} }, [theme]);
  useEffect(() => onWalletsChange(() => setWallets(solanaWallets())), []);

  const run = (label: string, f: () => Promise<void>) => async () => {
    setErr(''); setBusy(label);
    try { await f(); } catch (e: any) { setErr(String(e?.message ?? e).toLowerCase()); } finally { setBusy(''); }
  };
  const pick = (x: Wallet) => run('connecting', async () => { setAcct(await connect(x)); setW(x); })();
  const review = run('building', async () => {
    setPlan(undefined); setSig(undefined); setStatus(undefined);
    setPlan(await buildSwap(defaultCfg, { user: acct!.address, inputMint: MINTS[tok], amount: toBase(amt, DECIMALS[tok]), recipient: `near:${defaultCfg.nearRecipient}` }));
  });
  const sign = run('waiting for your wallet', async () => {
    const signed = await signWire(w!, acct!, plan!.wire);
    setBusy('sending'); setSig(await signAndSend(defaultCfg.kora, signed));
  });
  const check = run('checking', async () => {
    const s = await transferStatus(sig!);
    setStatus(!s.found ? 'not seen by the bridge yet' : s.finalised ? 'in your near account' : s.onNear ? 'on near, finishing' : s.signed ? 'bridging to near' : 'swapped, waiting for the bridge');
  });

  return (
    <main>
      <div className="top">
        <h1>strom <span className="label">by seedless</span></h1>
        <button className="ghost" aria-label="toggle theme" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>{theme === 'dark' ? '☀' : '☾'}</button>
      </div>

      {!acct ? (
        <div className="card">
          <span className="label">connect your wallet</span>
          {wallets.length ? wallets.map(x => <button key={x.name} className="ghost" onClick={() => pick(x)}>{x.name.toLowerCase()}</button>)
            : <span>no solana wallet found in this browser</span>}
        </div>
      ) : (
        <>
          <div className="row"><span>{w!.name.toLowerCase()}</span><span>{short(acct.address)}</span></div>
          <div className="card">
            <span className="label">you send · solana</span>
            <div style={{ display: 'flex', gap: 8 }}>
              <input inputMode="decimal" value={amt} onChange={e => setAmt(e.target.value)} />
              <select value={tok} onChange={e => setTok(e.target.value as Tok)} style={{ width: 100 }}><option>usdc</option><option>sol</option></select>
            </div>
          </div>
          <button className="ghost" disabled={!!busy} onClick={review}>review swap</button>
          {plan && (
            <div className="card">
              <span className="label">you get · near</span>
              <span className="big">{fmt(plan.bridged, DECIMALS.near)} near</span>
              <div className="row"><span>to</span><span>{defaultCfg.nearRecipient}</span></div>
              <div className="row"><span>route</span><span>{plan.route.toLowerCase()}</span></div>
              <div className="row"><span>gas</span><span>{fmt(plan.koraFee, DECIMALS.usdc)} usdc · no sol needed</span></div>
              <div className="row"><span>signatures</span><span>1</span></div>
              <div className="row"><span>tx</span><span>v{plan.version} · {plan.accounts} accounts · {plan.bytes} bytes</span></div>
            </div>
          )}
          {plan && !sig && <button disabled={!!busy} onClick={sign}>sign in your wallet</button>}
          {sig && (
            <div className="card">
              <span className="label">sent</span>
              <a className="row" href={`https://solscan.io/tx/${sig}`} target="_blank" rel="noreferrer">{short(sig)} ↗</a>
              {status && <span>{status}</span>}
              <button className="ghost" disabled={!!busy} onClick={check}>where is my money</button>
            </div>
          )}
        </>
      )}
      {busy && <span className="label">{busy}…</span>}
      {err && <span className="err">{err}</span>}
    </main>
  );
}
