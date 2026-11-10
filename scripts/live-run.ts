// live run: the strom libs on solana + near mainnet with real funds (~$1). keys live outside the repo in ~/.strom-live.
// to-near: usdc -> near via buildSwap, user signs, our own mainnet kora (:8091) pays gas. asserts user sol spent 0,
//          waits for the omni relayer to finalise (token fee only) and the near to land on the user's intents account.
// to-sol:  the whole intents near balance -> sol via 1click, one signed message, relay pays near gas.
// usage: tsx scripts/live-run.ts to-near <usdc> | watch <sig> [nearBefore] | to-sol
import { readFileSync } from 'fs';
import { homedir } from 'os';
import { createSolanaRpc, createKeyPairFromBytes, getAddressFromPublicKey, getBase64Encoder, getTransactionDecoder,
  partiallySignTransaction, getBase64EncodedWireTransaction, signBytes, signature as sigOf } from '@solana/kit';
import { buildSwap } from '../src/lib/buildSwap';
import { signAndSend } from '../src/lib/kora';
import { transferStatus } from '../src/lib/omni';
import { MINTS, type Cfg } from '../src/lib/config';
import { nearAccountOf, intentsBalances, quoteNearToSol, transferPayload, signedIntent, simulate, publish, swapStatus, TOKENS } from '../src/lib/near';

const cfg: Cfg = { rpc: process.env.LIVE_RPC ?? 'https://api.mainnet-beta.solana.com', kora: process.env.LIVE_KORA ?? 'http://localhost:8091', nearRecipient: 'intents.near' };
const fail = (m: string) => { console.error('live run FAIL: ' + m); process.exit(1); };
const wait = (ms: number) => new Promise(r => setTimeout(r, ms));
const t0 = Date.now(), at = () => `${Math.round((Date.now() - t0) / 1000)}s`;

const kp = await createKeyPairFromBytes(new Uint8Array(JSON.parse(readFileSync(`${homedir()}/.strom-live/user.json`, 'utf8'))));
const user = await getAddressFromPublicKey(kp.publicKey), near = nearAccountOf(user);
const rpc = createSolanaRpc(cfg.rpc);
const lamports = async () => (await rpc.getBalance(user).send()).value;
console.log(`user ${user} · near ${near.slice(0, 12)}…`);

async function toNear(usdc: string) {
  const amount = BigInt(Math.round(Number(usdc) * 1e6));
  const plan = await buildSwap(cfg, { user, inputMint: MINTS.usdc, amount, recipient: 'near:intents.near' });
  console.log(`plan: ${plan.route} · bridged ${plan.bridged} · relay fee ${plan.relayFee} · kora fee ${plan.koraFee} usdc · v${plan.version} ${plan.accounts} accts ${plan.bytes} b`);
  const tx = getTransactionDecoder().decode(getBase64Encoder().encode(plan.wire));
  const signed = getBase64EncodedWireTransaction(await partiallySignTransaction([kp], tx as any));
  const before = await lamports(), nearBefore = (await intentsBalances(near))[TOKENS.near];
  const sig = await signAndSend(cfg.kora, signed);
  console.log(`sent ${sig}`);
  for (let i = 0; ; i++) {
    const { value: [s] } = await rpc.getSignatureStatuses([sigOf(sig)]).send();
    if (s?.err) fail(`tx failed: ${JSON.stringify(s.err)}`);
    if (s?.confirmationStatus === 'confirmed' || s?.confirmationStatus === 'finalized') break;
    if (i > 60) fail('not confirmed in 60s'); await wait(1000);
  }
  const spent = before - (await lamports());
  if (spent !== 0n) fail(`user spent ${spent} lamports`);
  console.log(`(a)(c) confirmed on mainnet at ${at()} · user sol spent 0`);
  await watch(sig, nearBefore);
}

// polls the bridge + the intents balance only. network blips are logged and retried, never fatal
async function watch(sig: string, nearBefore: bigint) {
  let last = '';
  for (;;) {
    const st = await transferStatus(sig).catch(e => ({ found: false, err: String(e) }) as any);
    const line = JSON.stringify(st); if (line !== last) { console.log(`${at()} bridge: ${line}`); last = line; }
    const bal = await intentsBalances(near).then(b => b[TOKENS.near]).catch(() => -1n);
    if (bal < 0n) { await wait(20_000); continue; }
    if (bal > nearBefore) { console.log(`(b) near on intents for ${near.slice(0, 12)}…: ${bal} (+${bal - nearBefore}) at ${at()}\nto-near PASS`); return; }
    if (Date.now() - t0 > 90 * 60_000) fail('no near on intents after 90 min');
    await wait(20_000);
  }
}

async function toSol() {
  const bal = (await intentsBalances(near))[TOKENS.near];
  if (!bal) fail('no near on intents');
  const q = await quoteNearToSol({ solAddress: user, amount: bal });
  console.log(`quote: ${bal} near -> ${q.amountOut} lamports (min ${q.minAmountOut}) · deposit ${q.depositAddress}`);
  const payload = transferPayload({ nearAccount: near, to: q.depositAddress!, token: TOKENS.near, amount: BigInt(q.amountIn) });
  const s = signedIntent(payload, new Uint8Array(await signBytes(kp.privateKey, new TextEncoder().encode(payload))), user);
  await simulate(s); console.log('simulate ok');
  console.log(`published ${await publish(s)}`);
  const before = await lamports(); let last = '';
  for (;;) {
    const st = await swapStatus(q.depositAddress!);
    if (st.status !== last) { console.log(`${at()} 1click: ${st.status} · ${st.words}${st.solTx ? ' · ' + st.solTx : ''}`); last = st.status; }
    if (st.status === 'SUCCESS') { await wait(5000); console.log(`sol in wallet: ${(await lamports()) - before} lamports\nto-sol PASS`); return; }
    if (['REFUNDED', 'FAILED'].includes(st.status)) fail(st.words);
    if (Date.now() - t0 > 30 * 60_000) fail('1click not done in 30 min');
    await wait(10_000);
  }
}

const [mode, arg] = process.argv.slice(2);
if (mode === 'to-near') await toNear(arg ?? '0.95'); else if (mode === 'watch') await watch(arg, BigInt(process.argv[4] ?? '0')); else if (mode === 'to-sol') await toSol(); else fail('usage: to-near <usdc> | to-sol');
process.exit(0);
