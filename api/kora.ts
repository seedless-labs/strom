// kora relayer proxy, the seedless pattern: the paymaster key lives here, never in the app.
// the app calls /api/kora; this forwards to the hosted kora with the key, after checks.
// kora pays real sol, so a request must look like strom's own transaction or it is refused:
// - only getPayerSigner, estimateTransactionFee and signAndSendTransaction
// - the payer is the fee payer and nothing else: no top-level system or token instruction may touch it,
//   except as the destination of a CloseAccount (the wsol rent coming back)
// - every top-level program is one strom uses, and the omni bridge is in it
// - signAndSend must carry a usdc fee to the payer's usdc account that covers what the tx really costs the payer
//   (simulated: network fee plus any rent it funds), never under 0.01 usdc
// plus a per-ip limit, a body cap, a short upstream timeout and a daily ceiling per instance.
import {
  address, getAddressEncoder, getProgramDerivedAddress, getBase64Encoder, getTransactionDecoder,
  getCompiledTransactionMessageDecoder, type CompiledTransactionMessage,
} from '@solana/kit';

const UPSTREAM = process.env.KORA_UPSTREAM ?? 'https://kora.lazorkit.com';
const MAX_BODY = 64 * 1024;
const TIMEOUT_MS = 20_000;
const PER_IP_PER_MIN = 20;
const DAILY = Number(process.env.KORA_DAILY) > 0 ? Number(process.env.KORA_DAILY) : 2_000;

const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const TOKEN = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const TOKEN22 = 'TokenzQdBNbLqP5VEhdkAS6EHFLwvy1AdPwqm5nLD6x5';
const ATA = 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL';
const SYSTEM = '11111111111111111111111111111111';
const OMNI = 'dahPEoZGXfyV58JqqH85okdHmpN8U2q8owgPUXSCPxe';
const ALLOWED = new Set([
  'ComputeBudget111111111111111111111111111111', TOKEN, TOKEN22, ATA, SYSTEM, OMNI,
  'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4', // jupiter v6
  'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr',
]);
const BASE_FEE = 10_000n; // 0.01 usdc, strom's floor
const RPC = process.env.SOLANA_RPC ?? 'https://api.mainnet-beta.solana.com';
const SOL = 'So11111111111111111111111111111111111111112';
const METHODS = new Set(['getPayerSigner', 'estimateTransactionFee', 'signAndSendTransaction']);

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
const rpcErr = (id: unknown, message: string, status = 403) => json({ jsonrpc: '2.0', id, error: { code: -32000, message } }, status);

// per-instance counters. the firewall rate rule on /api/kora is the shared limit; these stop a burst on one instance.
const hits = new Map<string, { n: number; t: number }>();
let day = { d: '', n: 0 };
function allow(ip: string): boolean {
  const now = Date.now();
  const h = hits.get(ip);
  if (!h || now - h.t > 60_000) hits.set(ip, { n: 1, t: now });
  else if (++h.n > PER_IP_PER_MIN) return false;
  if (hits.size > 5_000) hits.clear();
  const d = new Date().toISOString().slice(0, 10);
  if (day.d !== d) day = { d, n: 0 };
  return ++day.n <= DAILY;
}

async function upstream(method: string, params: object) {
  const key = process.env.KORA_API_KEY!;
  const r = await fetch(UPSTREAM, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json', 'x-api-key': key, authorization: `Bearer ${key}` },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  return { status: r.status, body: await r.json().catch(() => ({ error: { message: 'bad upstream reply' } })) };
}

let payerCache: { addr: string; usdcAta: string; t: number } | undefined;
async function payer() {
  if (payerCache && Date.now() - payerCache.t < 10 * 60_000) return payerCache;
  const r = await upstream('getPayerSigner', {});
  const addr: string | undefined = r.body?.result?.signer_address;
  if (!addr) throw new Error('no payer');
  const enc = getAddressEncoder();
  const [usdcAta] = await getProgramDerivedAddress({
    programAddress: address(ATA), seeds: [enc.encode(address(addr)), enc.encode(address(TOKEN)), enc.encode(address(USDC))],
  });
  payerCache = { addr, usdcAta, t: Date.now() };
  return payerCache;
}

// sol price for pricing the payer's spend. cached; a failed lookup uses a high fallback so the user is never undercharged
let solUsd = { v: 0, t: 0 };
async function solPrice(): Promise<number> {
  if (solUsd.v && Date.now() - solUsd.t < 5 * 60_000) return solUsd.v;
  try {
    const r = await fetch(`https://lite-api.jup.ag/price/v3?ids=${SOL}`, { signal: AbortSignal.timeout(4000) });
    const v = Number((await r.json())?.[SOL]?.usdPrice);
    if (v > 0) { solUsd = { v, t: Date.now() }; return v; }
  } catch { /* fallback below */ }
  return Number(process.env.KORA_SOL_USD) > 0 ? Number(process.env.KORA_SOL_USD) : 400;
}

// what this tx really costs the payer: simulate it and read the payer's lamports before and after.
// this catches network fees and any rent the payer funds (new token accounts), which a user could later close and keep.
// the usdc fee must cover it with a 20% margin, and never less than strom's floor.
async function need(wire: string, payerAddr: string, quoted: bigint): Promise<{ why?: string; fee?: bigint }> {
  const call = (method: string, params: unknown[]) => fetch(RPC, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }), signal: AbortSignal.timeout(8000),
  }).then(r => r.json());
  const [bal, sim] = await Promise.all([
    call('getBalance', [payerAddr, { commitment: 'processed' }]),
    call('simulateTransaction', [wire, { encoding: 'base64', sigVerify: false, replaceRecentBlockhash: true, commitment: 'processed',
      accounts: { encoding: 'base64', addresses: [payerAddr] } }]),
  ]);
  const v = sim?.result?.value;
  const after = v?.accounts?.[0]?.lamports;
  if (v?.err || typeof after !== 'number' || typeof bal?.result?.value !== 'number') return { why: 'transaction does not simulate' };
  const spent = BigInt(Math.max(0, bal.result.value - after));
  const usd = await solPrice();
  // lamports → micro-usdc: lamports * usd / 1e3, plus 20%
  const cost = (spent * BigInt(Math.ceil(usd * 100)) * 12n) / (1000n * 100n * 10n) + 1n;
  const fee = [BASE_FEE, quoted, cost].reduce((a, b) => (b > a ? b : a));
  return { fee };
}

type Check = { why?: string; fee?: bigint };
function inspect(wireB64: string, payerAddr: string, payerUsdc: string): Check {
  let msg: CompiledTransactionMessage;
  try {
    const tx = getTransactionDecoder().decode(getBase64Encoder().encode(wireB64));
    msg = getCompiledTransactionMessageDecoder().decode(tx.messageBytes) as CompiledTransactionMessage;
  } catch { return { why: 'not a transaction' }; }
  if (!('instructions' in msg)) return { why: 'strom sends v0 transactions only' };
  const keys = msg.staticAccounts.map(String);
  if (keys[0] !== payerAddr) return { why: 'fee payer is not the relayer' };
  let omni = false; let fee = 0n;
  for (const ix of msg.instructions) {
    const prog = keys[ix.programAddressIndex];
    if (!prog || !ALLOWED.has(prog)) return { why: `program not allowed: ${prog ?? '?'}` };
    if (prog === OMNI) omni = true;
    const accts = ix.accountIndices ?? [];
    const d = ix.data;
    // the one way the payer may appear: as the destination of an spl CloseAccount (9: [account, destination, owner]),
    // which returns the rent of the temporary wsol account it funded
    const rentBack = prog === TOKEN && d?.[0] === 9 && accts[1] === 0 && accts[0] !== 0 && accts[2] !== 0;
    if ((prog === SYSTEM || prog === TOKEN || prog === TOKEN22) && accts.includes(0) && !rentBack) return { why: 'instruction spends the relayer' };
    // spl Transfer (3): [src, dst, owner] · amount u64 le at 1
    if (prog === TOKEN && d && d[0] === 3 && d.length >= 9 && keys[accts[1]] === payerUsdc) {
      fee += new DataView(d.buffer, d.byteOffset + 1, 8).getBigUint64(0, true);
    }
  }
  if (!omni) return { why: 'not a strom transaction' };
  return { fee };
}

export async function POST(req: Request): Promise<Response> {
  if (!process.env.KORA_API_KEY) return json({ error: 'relayer is not configured' }, 503);
  const ip = req.headers.get('x-real-ip') ?? req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
  if (!allow(ip)) return json({ error: 'busy, try again in a minute' }, 429);

  const raw = await req.arrayBuffer();
  if (raw.byteLength > MAX_BODY) return json({ error: 'body too large' }, 413);
  let rpc: any;
  try { rpc = JSON.parse(new TextDecoder().decode(raw)); } catch { return json({ error: 'bad json' }, 400); }
  const { id, method, params } = rpc ?? {};
  if (!METHODS.has(method)) return rpcErr(id, 'method not allowed');

  try {
    if (method !== 'getPayerSigner') {
      const p = await payer();
      const wire = typeof params?.transaction === 'string' ? params.transaction : '';
      const c = inspect(wire, p.addr, p.usdcAta);
      if (c.why) { console.warn('[kora] refused', c.why); return rpcErr(id, c.why); }
      if (method === 'estimateTransactionFee' && params?.fee_token !== USDC) return rpcErr(id, 'fee token must be usdc');
      const est = await upstream('estimateTransactionFee', { transaction: wire, fee_token: USDC });
      const n = await need(wire, p.addr, BigInt(est.body?.result?.fee_in_token ?? 0));
      if (n.why) { console.warn('[kora] refused', n.why); return rpcErr(id, n.why); }
      if (method === 'estimateTransactionFee') {
        // strom's price for this tx: what the payer really spends, in usdc
        return json({ jsonrpc: '2.0', id, result: { ...(est.body?.result ?? {}), fee_in_token: Number(n.fee) } });
      }
      if (c.fee! * 10n < n.fee! * 9n) return rpcErr(id, 'relayer fee missing or too low');
    }
    const r = await upstream(method, method === 'getPayerSigner' ? {} : { transaction: params.transaction, ...(params.fee_token ? { fee_token: params.fee_token } : {}) });
    return json({ ...r.body, id }, r.status);
  } catch (e) {
    console.error('[kora] upstream', (e as Error).message);
    return rpcErr(id, 'relayer is busy, try again', 502);
  }
}
