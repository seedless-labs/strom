// jupiter lite api: quote + raw swap instructions, mapped to kit instructions (ported from p1/p3c).
import { address, AccountRole, type Instruction } from '@solana/kit';
import { API, JUP_MAX_ACCOUNTS, MINTS, SLIPPAGE_BPS } from './config';
import { ata } from './omni';

export type JupIx = { programId: string; accounts: { pubkey: string; isSigner: boolean; isWritable: boolean }[]; data: string };
export type Quote = { inAmount: string; outAmount: string; otherAmountThreshold: string; routePlan: { swapInfo: { label: string } }[]; [k: string]: unknown };

const b64 = (s: string) => Uint8Array.from(atob(s), c => c.charCodeAt(0));

export const toIx = (i: JupIx): Instruction => ({
  programAddress: address(i.programId),
  accounts: i.accounts.map(a => ({
    address: address(a.pubkey),
    role: a.isSigner ? (a.isWritable ? AccountRole.WRITABLE_SIGNER : AccountRole.READONLY_SIGNER)
                     : (a.isWritable ? AccountRole.WRITABLE : AccountRole.READONLY),
  })),
  data: b64(i.data),
});

// the lite api allows ~5 calls per window, then answers 429 with an empty-ish body. wait for its reset and retry
async function jup(path: string, init?: RequestInit): Promise<any> {
  for (let i = 0; ; i++) {
    const r = await fetch(`${API.jupiter}${path}`, init);
    if (r.status === 429 && i < 4) {
      const reset = Number(r.headers.get('x-ratelimit-reset')) * 1000 - Date.now();
      await new Promise(ok => setTimeout(ok, Math.min(Math.max(reset, 1000), 10_000)));
      continue;
    }
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(`jupiter ${path.split('?')[0]}: ${r.status} ${j.error ?? j.message ?? ''}`.trim());
    return j;
  }
}

export async function quote(inputMint: string, outputMint: string, amount: bigint, slippageBps = SLIPPAGE_BPS, maxAccounts = JUP_MAX_ACCOUNTS, direct = false): Promise<Quote> {
  const q = await jup(`/quote?inputMint=${inputMint}&outputMint=${outputMint}&amount=${amount}&slippageBps=${slippageBps}&maxAccounts=${maxAccounts}${direct ? '&onlyDirectRoutes=true' : ''}`);
  if (q.error || !q.outAmount) throw new Error('jupiter quote: ' + (q.error ?? 'no route'));
  checkQuote(q, inputMint, outputMint, amount, slippageBps);
  return q;
}

// the quote is a server's answer. before anything is built from it: it is for these mints and this amount in,
// and its minimum out is no lower than the slippage that was asked for allows (1 unit of rounding slack).
export function checkQuote(q: Quote, inputMint: string, outputMint: string, amount: bigint, slippageBps: number) {
  const bad = (why: string) => new Error(`jupiter quote does not match the request (${why})`);
  const n = (v: unknown) => (typeof v === 'string' && /^\d+$/.test(v) ? BigInt(v) : -1n);
  if (q.inputMint !== inputMint) throw bad('input mint');
  if (q.outputMint !== outputMint) throw bad('output mint');
  if (n(q.inAmount) !== amount) throw bad('amount in');
  const out = n(q.outAmount), min = n(q.otherAmountThreshold);
  if (out <= 0n || min <= 0n || min > out) throw bad('amount out');
  if (min + 1n < (out * BigInt(10_000 - slippageBps)) / 10_000n) throw bad('minimum out');
}

// with a payer, kora funds the user's temporary wsol account. jupiter's cleanup closes it with the rent going to the user,
// which would let every sol swap pocket the payer's rent. send it back to the payer instead (spl CloseAccount = 9:
// [account, destination, owner]); the proxy only allows the payer in that destination slot.
// only the user's own wsol account may be closed this way: any other close in the cleanup is refused.
const TOKEN_PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
export function rentBack(i: JupIx, payer?: string, wsol?: string): JupIx {
  if (!payer || i.programId !== TOKEN_PROGRAM || b64(i.data)[0] !== 9 || !i.accounts[1]) return i;
  if (!wsol || i.accounts[0].pubkey !== wsol) throw new Error('jupiter cleanup closes an account that is not your wsol account');
  return { ...i, accounts: i.accounts.map((a, n) => (n === 1 ? { ...a, pubkey: payer } : a)) };
}

// compute-budget ixs are dropped: tx v1 carries the cu limit in its config
export async function swapInstructions(q: Quote, user: string, payer?: string): Promise<{ ixs: Instruction[]; alts: string[] }> {
  const si = await jup('/swap-instructions', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    // payer: kora funds any token-account rent so the user needs no sol
    body: JSON.stringify({ quoteResponse: q, userPublicKey: user, wrapAndUnwrapSol: true, ...(payer && { payer }) }),
  });
  if (si.error || !si.swapInstruction) throw new Error('jupiter swap-instructions: ' + (si.error ?? 'no swap instruction'));
  const wsol = payer && si.cleanupInstruction ? String(await ata(user, MINTS.sol)) : undefined;
  // v1 inlines every account (buildSwap enforces the 64 cap); alts are kept for the v0 fallback
  return {
    ixs: [
      ...(si.setupInstructions ?? []).map(toIx),
      toIx(si.swapInstruction),
      ...(si.cleanupInstruction ? [toIx(rentBack(si.cleanupInstruction, payer, wsol))] : []),
    ],
    alts: si.addressLookupTableAddresses ?? [],
  };
}

export const routeLabel = (q: Quote) => q.routePlan.map(r => r.swapInfo.label).join(' + ');
