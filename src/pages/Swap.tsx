// test surface: sol -> near (one signature, kora pays gas) and near -> sol (one signed message, relay pays near gas).
// the full swap/track screens from canvas v8 land in chunk 3.
import { useEffect, useState } from 'react';
import type { Wallet, WalletAccount } from '@wallet-standard/base';
import { MINTS, DECIMALS, defaultCfg } from '../lib/config';
import { buildSwap, type SwapPlan } from '../lib/buildSwap';
import { signAndSend } from '../lib/kora';
import { transferStatus } from '../lib/omni';
import { solanaWallets, onWalletsChange, connect, signWire, signMsg } from '../wallet';
import { nearAccountOf, intentsBalances, quoteNearToSol, transferPayload, signedIntent, simulate, publish, swapStatus, TOKENS, NEAR_DECIMALS, type Quote } from '../lib/near';

type Tok = 'usdc' | 'sol';
const toBase = (v: string, d: number) => { const [i, f = ''] = v.trim().split('.'); return BigInt(i || '0') * 10n ** BigInt(d) + BigInt((f + '0'.repeat(d)).slice(0, d) || '0'); };
const fmt = (v: bigint, d: number, p = 4) => (Number(v) / 10 ** d).toFixed(p);
const short = (s: string) => `${s.slice(0, 4)}…${s.slice(-4)}`;

export default function Swap() {
  const [theme, setTheme] = useState<'dark' | 'light'>(() => { try { return (localStorage.getItem('theme') as any) || 'dark'; } catch { return 'dark'; } });
  const [wallets, setWallets] = useState<Wallet[]>(solanaWallets);
  const [w, setW] = useState<Wallet>(); const [acct, setAcct] = useState<WalletAccount>();
  const [tok, setTok] = useState<Tok>('usdc'); const [amt, setAmt] = useState('10');
  const [plan, setPlan] = useState<SwapPlan>(); const [sig, setSig] = useState<string>();
  const [status, setStatus] = useState<string>(); const [busy, setBusy] = useState(''); const [err, setErr] = useState('');
  const [dir, setDir] = useState<'to-near' | 'to-sol'>('to-near');
  const [nearBal, setNearBal] = useState<bigint>(); const [nAmt, setNAmt] = useState('1');
  const [nq, setNq] = useState<Quote>(); const [nStatus, setNStatus] = useState<string>();

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
  const nearAcct = acct ? nearAccountOf(acct.address) : '';
  const loadNear = run('reading your near balance', async () => { setNearBal((await intentsBalances(nearAcct))[TOKENS.near]); });
  useEffect(() => { if (acct && dir === 'to-sol') loadNear(); }, [acct, dir]);
  const reviewNear = run('getting a quote', async () => {
    setNq(undefined); setNStatus(undefined);
    setNq(await quoteNearToSol({ solAddress: acct!.address, amount: toBase(nAmt, NEAR_DECIMALS) }));
  });
  const signNear = run('waiting for your wallet', async () => {
    const payload = transferPayload({ nearAccount: nearAcct, to: nq!.depositAddress!, token: TOKENS.near, amount: BigInt(nq!.amountIn) });
    const s = signedIntent(payload, await signMsg(w!, acct!, new TextEncoder().encode(payload)), acct!.address);
    setBusy('checking on near'); await simulate(s);
    setBusy('sending'); await publish(s); setNStatus('sent, swapping to sol');
  });
  const checkNear = run('checking', async () => { const s = await swapStatus(nq!.depositAddress!); setNStatus(s.words); });
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
          <div style={{ display: 'flex', gap: 8 }}>
            <button className={dir === 'to-near' ? '' : 'ghost'} style={{ flex: 1 }} onClick={() => setDir('to-near')}>sol → near</button>
            <button className={dir === 'to-sol' ? '' : 'ghost'} style={{ flex: 1 }} onClick={() => setDir('to-sol')}>near → sol</button>
          </div>
          {dir === 'to-sol' ? (<>
          <div className="card">
            <span className="label">you send · near (your near intents balance)</span>
            <div className="row"><span>balance</span><span>{nearBal === undefined ? '…' : fmt(nearBal, NEAR_DECIMALS)} near</span></div>
            <input inputMode="decimal" value={nAmt} onChange={e => setNAmt(e.target.value)} />
          </div>
          <button className="ghost" disabled={!!busy} onClick={reviewNear}>review swap</button>
          {nq && (
            <div className="card">
              <span className="label">you get · solana</span>
              <span className="big">{fmt(BigInt(nq.amountOut), 9)} sol</span>
              <div className="row"><span>at least</span><span>{fmt(BigInt(nq.minAmountOut), 9)} sol</span></div>
              <div className="row"><span>to</span><span>{short(acct.address)}</span></div>
              <div className="row"><span>time</span><span>~{nq.timeEstimate ?? '?'}s</span></div>
              <div className="row"><span>gas</span><span>none, the relay pays near gas</span></div>
              <div className="row"><span>signatures</span><span>1 message</span></div>
            </div>
          )}
          {nq && !nStatus && <button disabled={!!busy} onClick={signNear}>sign in your wallet</button>}
          {nStatus && (
            <div className="card">
              <span>{nStatus}</span>
              <button className="ghost" disabled={!!busy} onClick={checkNear}>where is my money</button>
            </div>
          )}
          </>) : (<>
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
              <div className="row"><span>to</span><span>your near account {nearAccountOf(acct.address).slice(0, 8)}…</span></div>
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
          </>)}
        </>
      )}
      {busy && <span className="label">{busy}…</span>}
      {err && <span className="err">{err}</span>}
    </main>
  );
}
