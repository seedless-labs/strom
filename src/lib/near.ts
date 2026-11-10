// near side. a solana wallet's ed25519 key is also a near implicit account (hex of the pubkey), proven in p5.
// near -> sol: 1click quote, the user signs one intents "transfer" to the quote's deposit address with signMessage,
// the solver relay publishes it (relay pays near gas), 1click swaps to sol and pays out on solana.
import { getBase58Encoder, getBase58Decoder } from '@solana/kit';
import { API } from './config';

export const ONECLICK = 'https://1click.chaindefuser.com/v0';
export const RELAY = 'https://solver-relay-v2.chaindefuser.com/rpc';
export const INTENTS = 'intents.near';
export const TOKENS = { near: 'nep141:wrap.near', sol: 'nep141:sol.omft.near' } as const;
export const NEAR_DECIMALS = 24; // wrap.near on near. the solana side (3ZLek) has 9

const hex = (b: Uint8Array) => Array.from(b, x => x.toString(16).padStart(2, '0')).join('');
export const nearAccountOf = (solAddress: string) => hex(new Uint8Array(getBase58Encoder().encode(solAddress)));

async function view<T>(contract: string, method: string, args: object): Promise<T> {
  const r = await (await fetch(API.nearRpc, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'query', params: { request_type: 'call_function', finality: 'final',
      account_id: contract, method_name: method, args_base64: btoa(JSON.stringify(args)) } }) })).json();
  if (r.error || r.result?.error) throw new Error(`${method}: ${JSON.stringify(r.error ?? r.result.error).slice(0, 300)}`);
  return JSON.parse(new TextDecoder().decode(new Uint8Array(r.result.result)));
}

// what the user holds inside near intents, keyed by token id
export async function intentsBalances(nearAccount: string, tokens: string[] = Object.values(TOKENS)) {
  const v = await view<string[]>(INTENTS, 'mt_batch_balance_of', { account_id: nearAccount, token_ids: tokens });
  return Object.fromEntries(tokens.map((t, i) => [t, BigInt(v[i] ?? '0')])) as Record<string, bigint>;
}

export type Quote = { depositAddress?: string; amountIn: string; amountOut: string; minAmountOut: string; amountOutUsd?: string; timeEstimate?: number; withdrawFee?: string };

export async function quoteNearToSol(p: { solAddress: string; amount: bigint; dry?: boolean; slippageBps?: number }): Promise<Quote> {
  const r = await fetch(`${ONECLICK}/quote`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({
    dry: p.dry ?? false, swapType: 'EXACT_INPUT', slippageTolerance: p.slippageBps ?? 100,
    originAsset: TOKENS.near, depositType: 'INTENTS', destinationAsset: TOKENS.sol, amount: p.amount.toString(),
    refundTo: nearAccountOf(p.solAddress), refundType: 'INTENTS', recipient: p.solAddress, recipientType: 'DESTINATION_CHAIN',
    deadline: new Date(Date.now() + 10 * 60_000).toISOString() }) });
  const j = await r.json();
  if (!r.ok || !j.quote) throw new Error(`quote: ${j.message ?? r.status}`);
  return j.quote;
}

// the exact bytes the wallet signs (solana:signMessage). nep-413 style raw_ed25519 payload, as in p5/p6
export function transferPayload(p: { nearAccount: string; to: string; token: string; amount: bigint; nonce?: Uint8Array }) {
  const nonce = p.nonce ?? crypto.getRandomValues(new Uint8Array(32));
  return JSON.stringify({
    signer_id: p.nearAccount, verifying_contract: INTENTS,
    deadline: new Date(Date.now() + 5 * 60_000).toISOString(), nonce: btoa(String.fromCharCode(...nonce)),
    intents: [{ intent: 'transfer', receiver_id: p.to, tokens: { [p.token]: p.amount.toString() } }],
  });
}

export const signedIntent = (payload: string, signature: Uint8Array, solAddress: string) => ({
  standard: 'raw_ed25519', payload, public_key: `ed25519:${solAddress}`, signature: `ed25519:${getBase58Decoder().decode(signature)}`,
});
export type SignedIntent = ReturnType<typeof signedIntent>;

// read-only dry run on intents.near: checks signature, nonce, deadline and balance without moving anything
export const simulate = (s: SignedIntent) => view<unknown>(INTENTS, 'simulate_intents', { signed: [s] });

// the relay lands it on near and pays the gas. returns the relay's intent hash
export async function publish(s: SignedIntent): Promise<string> {
  const r = await (await fetch(RELAY, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'publish_intent', params: [{ quote_hashes: [], signed_data: s }] }) })).json();
  if (r.error || r.result?.status !== 'OK') throw new Error(`publish: ${JSON.stringify(r.error ?? r.result).slice(0, 300)}`);
  return r.result.intent_hash;
}

// 1click status, mapped to plain words for the track screen
export async function swapStatus(depositAddress: string) {
  const j = await (await fetch(`${ONECLICK}/status?depositAddress=${depositAddress}`)).json();
  const s: string = j.status ?? 'UNKNOWN';
  const words: Record<string, string> = { PENDING_DEPOSIT: 'waiting for your near', KNOWN_DEPOSIT_TX: 'near received', PROCESSING: 'swapping to sol',
    SUCCESS: 'sol is in your wallet', INCOMPLETE_DEPOSIT: 'amount too small, refunding', REFUNDED: 'refunded to your near balance', FAILED: 'failed, refunding' };
  return { status: s, words: words[s] ?? s.toLowerCase().replace(/_/g, ' '), solTx: j.swapDetails?.destinationChainTxHashes?.[0]?.hash as string | undefined };
}
