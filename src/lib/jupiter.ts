// jupiter lite api: quote + raw swap instructions, mapped to kit instructions (ported from p1/p3c).
import { address, AccountRole, type Instruction } from '@solana/kit';
import { API, JUP_MAX_ACCOUNTS, SLIPPAGE_BPS } from './config';

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

export async function quote(inputMint: string, outputMint: string, amount: bigint, slippageBps = SLIPPAGE_BPS, maxAccounts = JUP_MAX_ACCOUNTS): Promise<Quote> {
  const q = await jup(`/quote?inputMint=${inputMint}&outputMint=${outputMint}&amount=${amount}&slippageBps=${slippageBps}&maxAccounts=${maxAccounts}`);
  if (q.error || !q.outAmount) throw new Error('jupiter quote: ' + (q.error ?? 'no route'));
  return q;
}

// compute-budget ixs are dropped: tx v1 carries the cu limit in its config
export async function swapInstructions(q: Quote, user: string, payer?: string): Promise<{ ixs: Instruction[]; alts: string[] }> {
  const si = await jup('/swap-instructions', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    // payer: kora funds any token-account rent so the user needs no sol
    body: JSON.stringify({ quoteResponse: q, userPublicKey: user, wrapAndUnwrapSol: true, ...(payer && { payer }) }),
  });
  if (si.error || !si.swapInstruction) throw new Error('jupiter swap-instructions: ' + (si.error ?? 'no swap instruction'));
  // v1 inlines every account (buildSwap enforces the 64 cap); alts are kept for the v0 fallback
  return {
    ixs: [
      ...(si.setupInstructions ?? []).map(toIx),
      toIx(si.swapInstruction),
      ...(si.cleanupInstruction ? [toIx(si.cleanupInstruction)] : []),
    ],
    alts: si.addressLookupTableAddresses ?? [],
  };
}

export const routeLabel = (q: Quote) => q.routePlan.map(r => r.swapInfo.label).join(' + ');
