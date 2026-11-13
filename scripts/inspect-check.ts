// relayer inspect check: offline, $0, no keys. the strom template must pass; every tx that puts the relayer's
// signature to work for someone else must be refused. replays the jupiter + omni ixs captured for p3c.
// run: npx tsx scripts/inspect-check.ts
import { readFileSync } from 'fs';
import { homedir } from 'os';
import { address, AccountRole, generateKeyPair, getAddressFromPublicKey, getBase64EncodedWireTransaction, type Instruction } from '@solana/kit';
import { inspect } from '../api/kora';
import { toIx, type JupIx } from '../src/lib/jupiter';
import { initTransferIx, ata } from '../src/lib/omni';
import { feeTransferIx } from '../src/lib/kora';
import { composeV0 } from '../src/lib/buildSwap';
import { MINTS, PROGRAMS } from '../src/lib/config';

const { ixs, minOut } = JSON.parse(readFileSync(`${homedir()}/near-swap-spike/p3/fork/ixs.json`, 'utf8')) as { ixs: JupIx[]; minOut: string };
const [jupAta, jupSwap, captured] = ixs.map(toIx);
const user = captured.accounts![5].address as string;
const fresh = async () => getAddressFromPublicKey((await generateKeyPair()).publicKey);
const [payer, thief] = await Promise.all([fresh(), fresh()]);
const [uUsdc, kUsdc, tUsdc] = await Promise.all([ata(user, MINTS.usdc), ata(payer, MINTS.usdc), ata(thief, MINTS.usdc)]);
const bh = { blockhash: '11111111111111111111111111111111', lastValidBlockHeight: 0n } as any;
const WS = AccountRole.WRITABLE_SIGNER, W = AccountRole.WRITABLE;
const acct = (x: string, role: AccountRole) => ({ address: address(x), role });
const swap = (i: Instruction, at: Record<number, { address: any; role: AccountRole }>): Instruction =>
  ({ ...i, accounts: i.accounts!.map((a, n) => at[n] ?? a) });

const omni = await initTransferIx({ user, payer, mint: MINTS.near, amount: BigInt(minOut), recipient: 'near:intents.near', fee: 0n, nativeFee: 0n });
const fee = feeTransferIx(uUsdc, kUsdc, user, 10_000n);
const run = (list: Instruction[], o: Instruction = omni) =>
  inspect(getBase64EncodedWireTransaction(composeV0(payer, bh, list, {} as any, o)), payer, kUsdc as string);

const spl = (op: number, amount: bigint, accounts: Instruction['accounts']): Instruction => {
  const data = new Uint8Array(9); data[0] = op; new DataView(data.buffer).setBigUint64(1, amount, true);
  return { programAddress: address(PROGRAMS.token), accounts, data };
};
const omniAsSender = await initTransferIx({ user: payer, payer, mint: MINTS.usdc, amount: 1n, recipient: 'near:intents.near' });
const cases: [string, Instruction[], Instruction?][] = [
  // the report: jupiter with the relayer as transfer authority and its usdc account as the source
  ['jupiter, relayer as authority', [fee, jupAta, swap(jupSwap, { 1: acct(payer, WS), 2: acct(kUsdc, W), 3: acct(tUsdc, W) }), omni]],
  ['jupiter, relayer anywhere', [fee, jupAta, { ...jupSwap, accounts: [...jupSwap.accounts!, acct(payer, WS)] }, omni]],
  ['omni, relayer as sender', [fee, omniAsSender], omniAsSender],
  ['omni, relayer in another slot', [fee, swap(omni, { 4: acct(payer, WS) })]],
  ['omni, not init_transfer', [fee, { ...omni, data: Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8]) }]],
  ['token transfer from the relayer', [fee, spl(3, 1n, [acct(kUsdc, W), acct(tUsdc, W), acct(payer, WS)]), omni]],
  ['token approve by the relayer', [fee, spl(4, 1n, [acct(kUsdc, W), acct(thief, AccountRole.READONLY), acct(payer, WS)]), omni]],
  ['memo signed by the relayer', [fee, { programAddress: address('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr'), accounts: [acct(payer, WS)], data: new TextEncoder().encode('x') }, omni]],
  ['ata, relayer as the wallet', [fee, swap(jupAta, { 2: acct(payer, AccountRole.READONLY) }), omni]],
  ['no omni instruction', [fee, jupAta, jupSwap]],
];

let bad = 0;
const say = (ok: boolean, name: string, got: string) => { if (!ok) bad++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${name} → ${got}`); };
const good = run([fee, swap(jupAta, { 0: acct(payer, WS) }), jupSwap, omni]);
say(!good.why && good.fee === 10_000n, 'strom template (relayer funds the ata + the wormhole rent)', good.why ?? `passes, fee ${good.fee}`);
for (const [name, list, o] of cases) { const r = run(list, o); say(!!r.why, name, r.why ?? 'PASSED, should be refused'); }
console.log(bad ? `inspect check FAIL (${bad})` : 'inspect check PASS');
process.exit(bad ? 1 : 0);
