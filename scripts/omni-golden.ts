// golden check: src/lib/omni.ts init_transfer must match the official omni sdk byte for byte. no network, no keys.
import { Connection, PublicKey, Keypair, SYSVAR_CLOCK_PUBKEY, SYSVAR_RENT_PUBKEY, SystemProgram } from '@solana/web3.js';
import anchor from '@coral-xyz/anchor';
const { AnchorProvider, Wallet, BN } = anchor as any;
import { SolanaBridgeClient } from 'omni-bridge-sdk';
import { fromLegacyTransactionInstruction } from '@solana/compat';
import { initTransferIx } from '../src/lib/omni';
import { MINTS, PROGRAMS } from '../src/lib/config';

const user = Keypair.generate().publicKey;
const args = { amount: 2_709_000_000n, recipient: 'near:intents.near', fee: 12_345n, nativeFee: 6_789n, message: '' };

const c: any = new SolanaBridgeClient(new AnchorProvider(new Connection('http://127.0.0.1:1'), new Wallet(Keypair.generate()), {}));
const mint = new PublicKey(MINTS.near), TOKEN = new PublicKey(PROGRAMS.token);
const from = PublicKey.findProgramAddressSync([user.toBuffer(), TOKEN.toBuffer(), mint.toBuffer()], new PublicKey(PROGRAMS.ata))[0];
const legacy = await c.program.methods.initTransfer({
  amount: new BN(args.amount.toString()), recipient: args.recipient,
  fee: new BN(args.fee.toString()), nativeFee: new BN(args.nativeFee.toString()), message: args.message,
}).accountsStrict({
  authority: c.authority()[0], mint, from, vault: null, solVault: c.solVaultId()[0], user,
  common: {
    payer: user, config: c.config()[0], bridge: c.wormholeBridgeId()[0], feeCollector: c.wormholeFeeCollectorId()[0],
    sequence: c.wormholeSequenceId()[0], clock: SYSVAR_CLOCK_PUBKEY, rent: SYSVAR_RENT_PUBKEY,
    systemProgram: SystemProgram.programId, wormholeProgram: c.wormholeProgramId,
    message: c.shimMessageId()[0], wormholePostMessageShim: c.shimProgramId, wormholePostMessageShimEa: c.eventAuthorityId,
  },
  tokenProgram: TOKEN,
}).instruction();
const want = fromLegacyTransactionInstruction(legacy);
const got = await initTransferIx({ user: user.toBase58(), mint: MINTS.near, ...args });

const fail: string[] = [];
if (want.programAddress !== got.programAddress) fail.push(`program ${want.programAddress} vs ${got.programAddress}`);
const hex = (b?: ArrayLike<number>) => Buffer.from(b ?? []).toString('hex');
if (hex(want.data) !== hex(got.data)) fail.push(`data\n sdk  ${hex(want.data)}\n ours ${hex(got.data)}`);
const wa = want.accounts ?? [], ga = got.accounts ?? [];
if (wa.length !== ga.length) fail.push(`account count ${wa.length} vs ${ga.length}`);
wa.forEach((a, i) => {
  const b = ga[i];
  if (!b || a.address !== b.address || a.role !== b.role) fail.push(`acct ${i}: sdk ${a.address}/${a.role} ours ${b?.address}/${b?.role}`);
});
if (fail.length) { console.error('omni golden FAIL\n' + fail.join('\n')); process.exit(1); }
console.log(`omni golden PASS: ${wa.length} accounts, ${got.data?.length} data bytes match the sdk`);
