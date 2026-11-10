// near check: the near -> sol libs against mainnet, read-only. throwaway key, empty balance, nothing moves.
// proves: hex implicit account, balances view, live 1click quote, signed transfer intent accepted by intents.near
// up to the balance check, tampered signature rejected, relay reachable and rejects a bad signature.
import { webcrypto } from 'crypto';
import { getBase58Decoder } from '@solana/kit';
import { nearAccountOf, intentsBalances, quoteNearToSol, transferPayload, signedIntent, simulate, publish, TOKENS } from '../src/lib/near';

const fail = (m: string) => { console.error('near check FAIL: ' + m); process.exit(1); };
const kp = await webcrypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']) as CryptoKeyPair;
const pub = new Uint8Array(await webcrypto.subtle.exportKey('raw', kp.publicKey));
const sol = getBase58Decoder().decode(pub), near = nearAccountOf(sol);
if (near !== Buffer.from(pub).toString('hex')) fail('implicit account is not the pubkey hex');
console.log(`1/5 ${sol} = near ${near.slice(0, 12)}…`);

const bal = await intentsBalances(near);
if (bal[TOKENS.near] !== 0n) fail('fresh key has a balance?');
console.log('2/5 intents balances read:', Object.entries(bal).map(([k, v]) => `${k} ${v}`).join(', '));

const q = await quoteNearToSol({ solAddress: sol, amount: 10n ** 24n, dry: true });
console.log(`3/5 1click: 1 near -> ${q.amountOut} lamports (min ${q.minAmountOut}, ~${q.timeEstimate}s, $${q.amountOutUsd})`);

const payload = transferPayload({ nearAccount: near, to: 'intents.near', token: TOKENS.near, amount: 10n ** 24n });
const sig = new Uint8Array(await webcrypto.subtle.sign('Ed25519', kp.privateKey, new TextEncoder().encode(payload)));
const good = signedIntent(payload, sig, sol), bad = signedIntent(payload, sig.map((x, i) => (i ? x : x ^ 1)), sol);
const said = async (f: () => Promise<unknown>) => { try { return JSON.stringify(await f()); } catch (e: any) { return String(e?.message ?? e); } };
const g = await said(() => simulate(good)), b = await said(() => simulate(bad));
if (!/balance|overflow/i.test(g)) fail(`real sig should stop at balance, got: ${g}`);
if (!/signature/i.test(b)) fail(`tampered sig should fail on signature, got: ${b}`);
console.log('4/5 intents.near: real sig -> stops at balance · tampered -> rejected on signature');

const p = await said(() => publish(bad));
if (!/publish:/.test(p)) fail(`relay accepted a tampered intent?! ${p}`);
console.log(`5/5 relay reachable, rejects tampered: ${p.slice(0, 140)}\nnear check PASS`);
