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

export async function quote(inputMint: string, outputMint: string, amount: bigint, slippageBps = SLIPPAGE_BPS): Promise<Quote> {
  const u = `${API.jupiter}/quote?inputMint=${inputMint}&outputMint=${outputMint}&amount=${amount}&slippageBps=${slippageBps}&maxAccounts=${JUP_MAX_ACCOUNTS}`;
  const q = await (await fetch(u)).json();
  if (q.error || !q.outAmount) throw new Error('jupiter quote: ' + (q.error ?? 'no route'));
  return q;
}

// compute-budget ixs are dropped: tx v1 carries the cu limit in its config
export async function swapInstructions(q: Quote, user: string, payer?: string): Promise<{ ixs: Instruction[]; alts: string[] }> {
  const si = await (await fetch(`${API.jupiter}/swap-instructions`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    // payer: kora funds any token-account rent so the user needs no sol
    body: JSON.stringify({ quoteResponse: q, userPublicKey: user, wrapAndUnwrapSol: true, ...(payer && { payer }) }),
  })).json();
  if (si.error) throw new Error('jupiter swap-instructions: ' + si.error);
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
