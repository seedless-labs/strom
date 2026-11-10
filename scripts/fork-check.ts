// fork check: the strom libs end to end on a local mainnet fork. $0, throwaway keys, prod kora untouched.
// replays the jupiter ixs captured for p3c (live jupiter routes reference pools the fork never cloned),
// rebuilds the omni ix with src/lib/omni.ts (must match the captured one), composes v1, kora co-signs + sends.
// needs: solana-test-validator from ~/near-swap-spike/p3/fork (8899) + kora on :8090 with the throwaway key.
import { readFileSync } from 'fs';
import { homedir } from 'os';
import { createSolanaRpc, createKeyPairFromBytes, getAddressFromPublicKey, partiallySignTransaction,
  getBase64EncodedWireTransaction, signature as sigOf } from '@solana/kit';
import { toIx, type JupIx } from '../src/lib/jupiter';
import { initTransferIx, ata } from '../src/lib/omni';
import { payerSigner, estimateFee, signAndSend, feeTransferIx } from '../src/lib/kora';
import { composeV1, V1_MAX_ACCOUNTS, V1_MAX_BYTES } from '../src/lib/buildSwap';
import { MINTS } from '../src/lib/config';

const SPIKE = `${homedir()}/near-swap-spike/p3/`;
const RPC = process.env.FORK_RPC ?? 'http://127.0.0.1:8899', KORA = process.env.FORK_KORA ?? 'http://localhost:8090';
const fail = (m: string) => { console.error('fork check FAIL: ' + m); process.exit(1); };

const { ixs, minOut } = JSON.parse(readFileSync(SPIKE + 'fork/ixs.json', 'utf8')) as { ixs: JupIx[]; minOut: string };
const kp = await createKeyPairFromBytes(new Uint8Array(JSON.parse(readFileSync(SPIKE + 'user.json', 'utf8'))));
const user = await getAddressFromPublicKey(kp.publicKey);
const [jupAta, jupSwap, capturedOmni] = ixs.map(toIx);

// 1. omni ix vs the one proven on the fork in p3c. recipient is read back from the captured borsh data
const cd = capturedOmni.data!;
const rlen = new DataView(cd.buffer, cd.byteOffset).getUint32(24, true);
const recipient = new TextDecoder().decode(cd.slice(28, 28 + rlen));
const dv = new DataView(cd.buffer, cd.byteOffset), o = 28 + rlen;
const feeT = dv.getBigUint64(o, true) + (dv.getBigUint64(o + 8, true) << 64n), feeN = dv.getBigUint64(o + 16, true);
const omni = await initTransferIx({ user, mint: MINTS.near, amount: BigInt(minOut), recipient, fee: feeT, nativeFee: feeN });
const hex = (b?: ArrayLike<number>) => Buffer.from(b ?? []).toString('hex');
if (hex(omni.data) !== hex(cd)) fail(`omni data differs\n captured ${hex(cd)}\n ours     ${hex(omni.data)}`);
capturedOmni.accounts!.forEach((a, i) => {
  const b = omni.accounts![i];
  if (a.address !== b?.address || a.role !== b?.role) fail(`omni acct ${i}: captured ${a.address}/${a.role} ours ${b?.address}/${b?.role}`);
});
console.log(`1/3 omni ix = captured p3c ix (${omni.accounts!.length} accts, recipient ${recipient}, relayer fee ${feeT} + ${feeN} lamports)`);

// 2. compose v1 with kora as fee payer, fee in usdc
const rpc = createSolanaRpc(RPC);
const signer = await payerSigner(KORA);
const { value: bh } = await rpc.getLatestBlockhash().send();
const [uUsdc, kUsdc] = await Promise.all([ata(user, MINTS.usdc), ata(signer, MINTS.usdc)]);
const all = (fee: bigint) => [feeTransferIx(uUsdc, kUsdc, user, fee), jupAta, jupSwap, omni];
const fee = (await estimateFee(KORA, getBase64EncodedWireTransaction(composeV1(signer, bh, all(1n))), MINTS.usdc)) || 10_000n;
const tx = composeV1(signer, bh, all(fee));
const accts = new Set(all(fee).flatMap(i => [i.programAddress, ...i.accounts!.map(a => a.address)]).concat(signer as any)).size;
const signed = await partiallySignTransaction([kp], tx);
const wire = getBase64EncodedWireTransaction(signed);
const bytes = Buffer.from(wire, 'base64').length;
if (accts > V1_MAX_ACCOUNTS || bytes > V1_MAX_BYTES) fail(`caps: ${accts} accounts, ${bytes} bytes`);
console.log(`2/3 v1 tx: ${accts} accounts, ${bytes} bytes, kora fee ${fee} usdc base units, 1 user signature`);

// 3. kora signs as fee payer and sends; confirm on the fork
const sig = await signAndSend(KORA, wire);
for (let i = 0; i < 30; i++) {
  const { value: [s] } = await rpc.getSignatureStatuses([sigOf(sig)]).send();
  if (s?.err) fail(`tx ${sig} failed: ${JSON.stringify(s.err)}`);
  if (s?.confirmationStatus === 'confirmed' || s?.confirmationStatus === 'finalized') {
    const t: any = await rpc.getTransaction(sigOf(sig), { maxSupportedTransactionVersion: 1 as any, encoding: 'json' }).send();
    console.log(`3/3 confirmed ${sig} · ${t?.meta?.computeUnitsConsumed ?? '?'} cu\nfork check PASS`);
    process.exit(0);
  }
  await new Promise(r => setTimeout(r, 1000));
}
fail(`tx ${sig} not confirmed in 30s`);
