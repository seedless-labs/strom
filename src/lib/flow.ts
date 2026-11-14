// the two money flows as plain steps, lifted from the proven test surface with the same calls in the same order.
// to-near: buildSwap (v0 + strom alt) -> your wallet signs -> kora co-signs and sends -> omni bridge carries it.
// to-sol: 1click quote -> your wallet signs one near intent -> simulate -> publish -> 1click swaps to sol.
import type { Wallet, WalletAccount } from '@wallet-standard/base';
import { MINTS, DECIMALS, defaultCfg } from './config';
import { buildSwap, type SwapPlan } from './buildSwap';
import { signAndSend } from './kora';
import { transferStatus, ata } from './omni';
import { createSolanaRpc, address } from '@solana/kit';
import { signWire, signMsg } from '../wallet';
import { nearAccountOf, intentsBalances, quoteNearToSol, transferPayload, signedIntent, simulate, publish, swapStatus, TOKENS, NEAR_DECIMALS, type Quote } from './near';

export type Tok = 'usdc' | 'sol';
export type { SwapPlan, Quote };
export { NEAR_DECIMALS, DECIMALS, nearAccountOf };

export const toBase = (v: string, d: number) => {
  const [i, f = ''] = v.trim().split('.');
  return BigInt(i || '0') * 10n ** BigInt(d) + BigInt((f + '0'.repeat(d)).slice(0, d) || '0');
};
export const fmt = (v: bigint | string, d: number, p = 4) => (Number(v) / 10 ** d).toFixed(p);
/** what the wallet holds on solana, in base units. usdc reads the wallet's usdc account (0 if it has none) */
export async function solanaBalance(owner: string, tok: Tok): Promise<bigint> {
  const rpc = createSolanaRpc(defaultCfg.rpc);
  if (tok === 'sol') return BigInt((await rpc.getBalance(address(owner)).send()).value);
  try { return BigInt((await rpc.getTokenAccountBalance(address(await ata(owner, MINTS.usdc))).send()).value.amount); }
  catch { return 0n; }
}
// "all of it" keeps a little back: sol covers the relayer fee and the temporary wsol account; usdc covers the 0.01 fee
export const KEEP = { sol: 5_000_000n, usdc: 10_000n } as const;
export const spendable = (bal: bigint, tok: Tok) => (bal > KEEP[tok] ? bal - KEEP[tok] : 0n);
export const short = (s: string) => `${s.slice(0, 4)}…${s.slice(-4)}`;

/** step names the ui shows, in order */
export const TO_NEAR_STEPS = ['your wallet signs', 'swapped on solana', 'bridge picked it up', 'in your near account'] as const;
export const TO_SOL_STEPS = ['your wallet signs', 'near received', 'swapping to sol', 'sol is in your wallet'] as const;

type Step = (words: string) => void;

// ---- solana -> near ----
export function quoteToNear(user: string, tok: Tok, amount: string): Promise<SwapPlan> {
  return buildSwap(defaultCfg, { user, inputMint: MINTS[tok], amount: toBase(amount, DECIMALS[tok]), recipient: `near:${defaultCfg.nearRecipient}` });
}

export async function sendToNear(w: Wallet, acct: WalletAccount, plan: SwapPlan, step: Step = () => {}): Promise<string> {
  step('waiting for your wallet');
  const signed = await signWire(w, acct, plan.wire);
  step('sending');
  return signAndSend(defaultCfg.kora, signed);
}

/** where a solana -> near transfer is. index = how many of TO_NEAR_STEPS are done */
export async function trackToNear(sig: string): Promise<{ done: number; words: string }> {
  const s = await transferStatus(sig);
  if (!s.found) return { done: 2, words: 'swapped, waiting for the bridge to see it' };
  if (s.finalised) return { done: 4, words: 'in your near account' };
  if (s.onNear || s.signed) return { done: 3, words: 'bridging to near' };
  return { done: 3, words: 'the bridge has it' };
}

// ---- near -> solana ----
export async function nearBalance(solAddress: string): Promise<bigint> {
  return (await intentsBalances(nearAccountOf(solAddress)))[TOKENS.near] ?? 0n;
}

export function quoteToSol(solAddress: string, amount: string): Promise<Quote> {
  return quoteNearToSol({ solAddress, amount: toBase(amount, NEAR_DECIMALS) });
}

/** amount is what the user typed. that is what gets signed, never a number taken from the quote */
export async function sendToSol(w: Wallet, acct: WalletAccount, q: Quote, amount: string, step: Step = () => {}): Promise<string> {
  if (!q.depositAddress) throw new Error('quote has no deposit address, get a new quote');
  const typed = toBase(amount, NEAR_DECIMALS);
  if (typed <= 0n || BigInt(q.amountIn) !== typed) throw new Error('the quote is for a different amount, get a new quote');
  const payload = transferPayload({ nearAccount: nearAccountOf(acct.address), to: q.depositAddress, token: TOKENS.near, amount: typed });
  step(`sign to send ${amount} near to ${q.depositAddress.slice(0, 6)}…${q.depositAddress.slice(-6)}`);
  const s = signedIntent(payload, await signMsg(w, acct, new TextEncoder().encode(payload)), acct.address);
  step('checking on near');
  await simulate(s);
  step('sending');
  await publish(s);
  return q.depositAddress;
}

const SOL_DONE: Record<string, number> = { PENDING_DEPOSIT: 1, KNOWN_DEPOSIT_TX: 2, PROCESSING: 3, SUCCESS: 4 };

/** where a near -> solana swap is. index = how many of TO_SOL_STEPS are done */
export async function trackToSol(depositAddress: string): Promise<{ done: number; words: string; failed: boolean; solTx?: string }> {
  const s = await swapStatus(depositAddress);
  return { done: SOL_DONE[s.status] ?? 1, words: s.words, failed: ['FAILED', 'REFUNDED', 'INCOMPLETE_DEPOSIT'].includes(s.status), solTx: s.solTx };
}
