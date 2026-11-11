// makes strom's address lookup table once: the constant omni accounts (omniConstants), so the v0 bridge tx fits 1232
// bytes while the accounts the relayer reads stay static. funder pays the rent and is the authority.
// usage: tsx scripts/make-alt.ts  (prints the table address for VITE_STROM_ALT)
import { readFileSync } from 'fs';
import { homedir } from 'os';
import { createSolanaRpc, createKeyPairSignerFromBytes, getProgramDerivedAddress, getAddressEncoder, address, AccountRole,
  pipe, createTransactionMessage, setTransactionMessageFeePayerSigner, setTransactionMessageLifetimeUsingBlockhash,
  appendTransactionMessageInstructions, signTransactionMessageWithSigners, getBase64EncodedWireTransaction, getSignatureFromTransaction,
  type Instruction } from '@solana/kit';
import { omniConstants } from '../src/lib/omni';
import { PROGRAMS } from '../src/lib/config';

const ALT = address('AddressLookupTab1e1111111111111111111111111');
const rpc = createSolanaRpc(process.env.LIVE_RPC ?? 'https://api.mainnet-beta.solana.com');
const funder = await createKeyPairSignerFromBytes(new Uint8Array(JSON.parse(readFileSync(`${homedir()}/.strom-live/funder.json`, 'utf8'))));
const addrs = await omniConstants();

const slot = await rpc.getSlot({ commitment: 'finalized' }).send();
const slotLe = new Uint8Array(8); new DataView(slotLe.buffer).setBigUint64(0, slot, true);
const [table, bump] = await getProgramDerivedAddress({ programAddress: ALT, seeds: [getAddressEncoder().encode(funder.address), slotLe] });

const accounts = [
  { address: table, role: AccountRole.WRITABLE },
  { address: funder.address, role: AccountRole.READONLY_SIGNER, signer: funder },
  { address: funder.address, role: AccountRole.WRITABLE_SIGNER, signer: funder },
  { address: address(PROGRAMS.system), role: AccountRole.READONLY },
] as any;
const data = (tag: number, body: Uint8Array) => { const d = new Uint8Array(4 + body.length); new DataView(d.buffer).setUint32(0, tag, true); d.set(body, 4); return d; };
const create: Instruction = { programAddress: ALT, accounts, data: data(0, new Uint8Array([...slotLe, bump])) };
const list = new Uint8Array(8 + 32 * addrs.length); new DataView(list.buffer).setBigUint64(0, BigInt(addrs.length), true);
addrs.forEach((a, i) => list.set(getAddressEncoder().encode(a) as Uint8Array, 8 + 32 * i));
const extend: Instruction = { programAddress: ALT, accounts, data: data(2, list) };

const rent = await rpc.getMinimumBalanceForRentExemption(BigInt(56 + 32 * addrs.length)).send();
const bal = (await rpc.getBalance(funder.address).send()).value;
console.log(`table ${table} · ${addrs.length} addresses · rent ${rent} lamports · funder has ${bal}`);
if (bal < rent + 10_000n) { console.error('funder short'); process.exit(1); }

const { value: bh } = await rpc.getLatestBlockhash().send();
const tx = await signTransactionMessageWithSigners(pipe(createTransactionMessage({ version: 0 }),
  m => setTransactionMessageFeePayerSigner(funder, m), m => setTransactionMessageLifetimeUsingBlockhash(bh, m),
  m => appendTransactionMessageInstructions([create, extend], m)));
const sig = getSignatureFromTransaction(tx);
await rpc.sendTransaction(getBase64EncodedWireTransaction(tx), { encoding: 'base64' }).send();
for (let i = 0; i < 60; i++) {
  const { value: [s] } = await rpc.getSignatureStatuses([sig]).send();
  if (s?.err) { console.error(`failed ${sig}: ${JSON.stringify(s.err)}`); process.exit(1); }
  if (s?.confirmationStatus === 'confirmed' || s?.confirmationStatus === 'finalized') { console.log(`made ${table} · tx ${sig}`); process.exit(0); }
  await new Promise(r => setTimeout(r, 1000));
}
console.error(`not confirmed: ${sig}`); process.exit(1);
