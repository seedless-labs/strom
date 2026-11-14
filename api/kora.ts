// strom's relayer: pays the solana fee for strom's own transactions, from a strom-only fee payer.
// the payer key lives in server env (STROM_PAYER_KEY) and nowhere else. it holds a small balance on purpose:
// that balance is the most anyone could ever take from it. no shared key, no hosted upstream.
// a request must look like strom's own transaction or it is refused:
// - only getPayerSigner, estimateTransactionFee and signAndSendTransaction
// - the payer is the fee payer and nothing else: no top-level system or token instruction may touch it,
//   except as the destination of a CloseAccount (the wsol rent coming back) or of a system Transfer (a sol fee)
// - every top-level program is one strom uses, and the omni bridge is in it
// - signAndSend must carry a fee to the payer, in usdc (to its usdc account) or in sol (a system transfer), that covers
//   what the tx really costs the payer (simulated: network fee plus any rent it funds), never under 0.01 usdc worth
// - every other signature must already be there; the payer signs last and the rpc verifies all of them before sending
// plus a per-tx spend cap, a balance floor, a per-ip limit, a body cap and a daily ceiling per instance.
import { clientIp } from './_guard.js';
import {
  address, getAddressEncoder, getProgramDerivedAddress, getBase64Encoder, getTransactionDecoder,
  getCompiledTransactionMessageDecoder, type CompiledTransactionMessage, createKeyPairFromBytes,
  getAddressFromPublicKey, partiallySignTransaction, getBase64EncodedWireTransaction, getSignatureFromTransaction,
} from '@solana/kit';

const MAX_BODY = 64 * 1024;
const MAX_SPEND = 5_000_000n; // the most one tx may cost the payer before its fee comes back: 0.005 sol
const FLOOR = 2_000_000n;     // the payer stops paying below 0.002 sol, so it never fails half way
const DAILY_SPEND = Number(process.env.KORA_DAILY_LAMPORTS) > 0 ? BigInt(process.env.KORA_DAILY_LAMPORTS!) : 100_000_000n; // 0.1 sol per instance per day
const PER_IP_PER_MIN = 20;
const DAILY = Number(process.env.KORA_DAILY) > 0 ? Number(process.env.KORA_DAILY) : 2_000;

const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const TOKEN = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const TOKEN22 = 'TokenzQdBNbLqP5VEhdkAS6EHFLwvy1AdPwqm5nLD6x5';
const ATA = 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL';
const SYSTEM = '11111111111111111111111111111111';
const OMNI = 'dahPEoZGXfyV58JqqH85okdHmpN8U2q8owgPUXSCPxe';
const JUPITER = 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4'; // v6
const ALLOWED = new Set([
  'ComputeBudget111111111111111111111111111111', TOKEN, TOKEN22, ATA, SYSTEM, OMNI, JUPITER,
  'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr',
]);
// omni init_transfer, the only omni instruction strom sends: sha256("global:init_transfer")[0..8]
const INIT_TRANSFER = [174, 50, 134, 99, 122, 243, 243, 224];
const OMNI_SENDER = 5, OMNI_RENT_PAYER = 11; // idl account slots: the user, and who pays the wormhole message rent
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

let payerCache: { kp: CryptoKeyPair; addr: string; usdcAta: string } | undefined;
async function payer() {
  if (payerCache) return payerCache;
  const bytes = new Uint8Array(JSON.parse(process.env.STROM_PAYER_KEY!));
  if (bytes.length !== 64) throw new Error('payer key must be 64 bytes');
  const kp = await createKeyPairFromBytes(bytes);
  const addr = await getAddressFromPublicKey(kp.publicKey);
  const enc = getAddressEncoder();
  const [usdcAta] = await getProgramDerivedAddress({
    programAddress: address(ATA), seeds: [enc.encode(addr), enc.encode(address(TOKEN)), enc.encode(address(USDC))],
  });
  payerCache = { kp, addr, usdcAta };
  return payerCache;
}

const call = (method: string, params: unknown[]) => fetch(RPC, {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }), signal: AbortSignal.timeout(8000),
}).then(r => r.json());

// sol price for pricing the payer's spend. cached 5 minutes. a failed lookup reuses the last real price for up to an hour,
// then the operator's KORA_SOL_USD if set. with neither there is no price and the request is refused: no fixed guess.
let solUsd = { v: 0, t: 0 };
async function solPrice(): Promise<number> {
  if (solUsd.v && Date.now() - solUsd.t < 5 * 60_000) return solUsd.v;
  try {
    const r = await fetch(`https://lite-api.jup.ag/price/v3?ids=${SOL}`, { signal: AbortSignal.timeout(4000) });
    const v = Number((await r.json())?.[SOL]?.usdPrice);
    if (v > 0) { solUsd = { v, t: Date.now() }; return v; }
  } catch { /* fallback below */ }
  if (solUsd.v && Date.now() - solUsd.t < 60 * 60_000) return solUsd.v;
  if (Number(process.env.KORA_SOL_USD) > 0) return Number(process.env.KORA_SOL_USD);
  throw new Error('no sol price');
}

// what this tx really costs the payer: simulate it and read the payer's lamports before and after.
// this catches network fees and any rent the payer funds (new token accounts), which a user could later close and keep.
// the usdc fee must cover it with a 20% margin, and never less than strom's floor.
// solIn: lamports the tx itself pays the payer as its fee, added back so the fee is not netted against its own cost.
// returns the fee in micro-usdc (fee) and the same floor/cost in lamports (lamports)
// it also reads the payer's usdc account before and after: a tx that would lower it is refused, whatever its instructions say.
async function need(wire: string, payerAddr: string, payerUsdc: string, quoted: bigint, solIn = 0n): Promise<{ why?: string; fee?: bigint; lamports?: bigint; spent?: bigint; bal?: bigint }> {
  const [bal, tok, sim] = await Promise.all([
    call('getBalance', [payerAddr, { commitment: 'processed' }]),
    call('getTokenAccountBalance', [payerUsdc, { commitment: 'processed' }]),
    call('simulateTransaction', [wire, { encoding: 'base64', sigVerify: false, replaceRecentBlockhash: true, commitment: 'processed',
      accounts: { encoding: 'base64', addresses: [payerAddr, payerUsdc] } }]),
  ]);
  const v = sim?.result?.value;
  const after = v?.accounts?.[0]?.lamports;
  if (v?.err || typeof after !== 'number' || typeof bal?.result?.value !== 'number') return { why: 'this swap would fail on solana. check your wallet has enough for the amount and the fee' };
  // spl token account: amount is a u64 le at byte 64. a missing account holds nothing, so nothing can leave it
  const had = BigInt(tok?.result?.value?.amount ?? '0');
  const data = v.accounts[1]?.data?.[0];
  const raw = typeof data === 'string' ? getBase64Encoder().encode(data) : undefined;
  const has = raw && raw.length >= 72 ? new DataView(raw.buffer, raw.byteOffset + 64, 8).getBigUint64(0, true) : 0n;
  if (has < had) return { why: 'instruction spends the relayer' };
  const net = BigInt(bal.result.value) - BigInt(after) + solIn;
  const spent = net > 0n ? net : 0n;
  let usd: number;
  try { usd = await solPrice(); } catch { return { why: 'no fresh sol price right now. try again in a minute' }; }
  const cents = BigInt(Math.ceil(usd * 100));
  // lamports → micro-usdc: lamports * usd / 1e3, plus 20%
  const cost = (spent * cents * 12n) / (1000n * 100n * 10n) + 1n;
  const fee = [BASE_FEE, quoted, cost].reduce((a, b) => (b > a ? b : a));
  // the same in lamports: the usdc floor converted at a price rounded up (never undercharges), or the cost plus 20%
  const floor = (BASE_FEE * 1000n * 100n) / cents + 1n;
  const lamports = [floor, (spent * 12n) / 10n + 1n].reduce((a, b) => (b > a ? b : a));
  return { fee, lamports, spent, bal: BigInt(bal.result.value) };
}

type Check = { why?: string; fee?: bigint; sol?: bigint };
export function inspect(wireB64: string, payerAddr: string, payerUsdc: string): Check {
  let msg: CompiledTransactionMessage;
  try {
    const tx = getTransactionDecoder().decode(getBase64Encoder().encode(wireB64));
    msg = getCompiledTransactionMessageDecoder().decode(tx.messageBytes) as CompiledTransactionMessage;
  } catch { return { why: 'not a transaction' }; }
  if (!('instructions' in msg)) return { why: 'strom sends v0 transactions only' };
  const keys = msg.staticAccounts.map(String);
  if (keys[0] !== payerAddr) return { why: 'fee payer is not the relayer' };
  let omni = false; let fee = 0n; let sol = 0n;
  for (const ix of msg.instructions) {
    const prog = keys[ix.programAddressIndex];
    if (!prog || !ALLOWED.has(prog)) return { why: `program not allowed: ${prog ?? '?'}` };
    const accts = ix.accountIndices ?? [];
    const d = ix.data;
    // the payer signs the whole tx, so every program in it runs with the payer's authority. an allowed program id is
    // not enough: the payer (key 0) may sit in an account list only in the four slots below, where all it can lose is
    // lamports, and need() counts those.
    const only = (slot: number) => accts.indexOf(0) === slot && accts.lastIndexOf(0) === slot;
    if (prog === OMNI) {
      if (!d || !INIT_TRANSFER.every((b, i) => d[i] === b)) return { why: 'not a strom transaction' };
      if (accts[OMNI_SENDER] === undefined || accts[OMNI_SENDER] === 0) return { why: 'instruction spends the relayer' };
      omni = true;
    }
    // 1. rent payer of the wormhole message in omni init_transfer (never the sender)
    const omniRent = prog === OMNI && only(OMNI_RENT_PAYER);
    // 2. funder of a new associated token account (slot 0 of create / create idempotent)
    const ataFunder = prog === ATA && (d?.length ?? 0) <= 1 && (d?.[0] ?? 0) <= 1 && only(0);
    // 3. destination of an spl CloseAccount (9: [account, destination, owner]),
    // which returns the rent of the temporary wsol account it funded
    const rentBack = prog === TOKEN && d?.[0] === 9 && only(1);
    // 4. destination of a system Transfer (2: [from, to] · u64 le lamports at 4): the sol fee, paid by the user
    const solFee = prog === SYSTEM && d?.length === 12 && d[0] === 2 && d[1] === 0 && d[2] === 0 && d[3] === 0
      && accts.length === 2 && accts[1] === 0 && accts[0] !== 0;
    if (accts.includes(0) && !omniRent && !ataFunder && !rentBack && !solFee) return { why: 'instruction spends the relayer' };
    if (solFee) sol += new DataView(d!.buffer, d!.byteOffset + 4, 8).getBigUint64(0, true);
    // spl Transfer (3): [src, dst, owner] · amount u64 le at 1
    if (prog === TOKEN && d && d[0] === 3 && d.length >= 9 && keys[accts[1]] === payerUsdc) {
      fee += new DataView(d.buffer, d.byteOffset + 1, 8).getBigUint64(0, true);
    }
  }
  if (!omni) return { why: 'not a strom transaction' };
  return { fee, sol };
}

let spentToday = { d: '', n: 0n };

export async function POST(req: Request): Promise<Response> {
  if (!process.env.STROM_PAYER_KEY) return json({ error: 'relayer is not configured' }, 503);
  const ip = clientIp(req);
  if (!allow(ip)) return json({ error: 'busy, try again in a minute' }, 429);

  const raw = await req.arrayBuffer();
  if (raw.byteLength > MAX_BODY) return json({ error: 'body too large' }, 413);
  let rpc: any;
  try { rpc = JSON.parse(new TextDecoder().decode(raw)); } catch { return json({ error: 'bad json' }, 400); }
  const { id, method, params } = rpc ?? {};
  if (!METHODS.has(method)) return rpcErr(id, 'method not allowed');

  try {
    const p = await payer();
    if (method === 'getPayerSigner') return json({ jsonrpc: '2.0', id, result: { signer_address: p.addr, payment_address: p.addr } });

    const wire = typeof params?.transaction === 'string' ? params.transaction : '';
    const c = inspect(wire, p.addr, p.usdcAta);
    if (c.why) { console.warn('[kora] refused', c.why); return rpcErr(id, c.why); }
    const token = method === 'estimateTransactionFee' ? params?.fee_token : USDC;
    if (token !== USDC && token !== SOL) return rpcErr(id, 'fee token must be usdc or sol');
    const n = await need(wire, p.addr, p.usdcAta, 0n, c.sol);
    if (n.why) { console.warn('[kora] refused', n.why); return rpcErr(id, n.why); }
    if (n.spent! > MAX_SPEND) return rpcErr(id, 'this swap costs the relayer too much. try a smaller amount');
    if (n.bal! - n.spent! < FLOOR) { console.error('[kora] payer low', String(n.bal)); return rpcErr(id, 'the relayer is out of gas right now. try again later', 503); }
    // strom's price for this tx: what the payer really spends, in usdc or in lamports
    if (method === 'estimateTransactionFee') return json({ jsonrpc: '2.0', id, result: { fee_in_token: Number(token === SOL ? n.lamports : n.fee) } });

    // the fee already carries 20% over the payer's real spend. 3% slack covers the price moving between estimate and sign
    const paid = c.fee! * 100n >= n.fee! * 97n || c.sol! * 100n >= n.lamports! * 97n;
    if (!paid) return rpcErr(id, 'relayer fee missing or too low');
    const d = new Date().toISOString().slice(0, 10);
    if (spentToday.d !== d) spentToday = { d, n: 0n };
    if (spentToday.n + n.spent! > DAILY_SPEND) return rpcErr(id, 'the relayer hit its daily limit. try again tomorrow', 503);

    // every signature but the payer's must already be there: the payer signs last
    const tx = getTransactionDecoder().decode(getBase64Encoder().encode(wire));
    const missing = Object.entries(tx.signatures).some(([a, sig]) => a !== p.addr && (!sig || sig.every(b => b === 0)));
    if (missing) return rpcErr(id, 'sign the swap in your wallet first');
    const signed = await partiallySignTransaction([p.kp], tx);
    const sent = await call('sendTransaction', [getBase64EncodedWireTransaction(signed), { encoding: 'base64', preflightCommitment: 'processed', maxRetries: 5 }]);
    if (sent?.error) {
      const m = String(sent.error.message ?? '');
      console.warn('[kora] send failed', m.slice(0, 200));
      return rpcErr(id, /blockhash/i.test(m) ? 'the swap expired before it was sent. try again' : 'solana refused this swap. try again', 400);
    }
    spentToday.n += n.spent!;
    return json({ jsonrpc: '2.0', id, result: { signature: getSignatureFromTransaction(signed), signer_pubkey: p.addr } });
  } catch (e) {
    console.error('[kora]', (e as Error).message);
    return rpcErr(id, 'relayer is busy, try again', 502);
  }
}
