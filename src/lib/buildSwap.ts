// one tx, one user signature: kora fee (usdc) + jupiter swap into omni-bridged near + omni init_transfer to near.
// kora is the fee payer and co-signs + sends. v0 + jupiter lookup tables by default: the omni relayer only reads v0/legacy
// (root cause of the stuck 10 Nov run). v1 (proven p3c) stays behind cfg.txVersion = 1, falling back to v0 over its caps.
import {
  address, createSolanaRpc, createTransactionMessage, pipe, setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash, appendTransactionMessageInstructions, compileTransaction,
  getBase64EncodedWireTransaction, setTransactionMessageConfig, fetchAddressesForLookupTables,
  compressTransactionMessageUsingAddressLookupTables, type Instruction, type Address,
} from '@solana/kit';
import { MINTS, PROGRAMS, STROM_ALT, JUP_MAX_ACCOUNTS, CU_LIMIT, SLIPPAGE_BPS, type Cfg } from './config';
import { quote, swapInstructions, routeLabel, type Quote } from './jupiter';
import { initTransferIx, ata, transferFee } from './omni';
import { payerSigner, estimateFee, feeTransferIx } from './kora';
import { nearAccountOf } from './near';

export const V1_MAX_ACCOUNTS = 64;
export const V1_MAX_BYTES = 4096;
export const V0_MAX_BYTES = 1232;
const FALLBACK_FEE = 10_000n; // 0.01 usdc if kora returns 0

export type SwapPlan = {
  quote: Quote; route: string;
  bridged: bigint;          // minOut of the swap = amount sent over the bridge (base units of 3ZLek)
  koraFee: bigint;          // in feeMint base units
  relayFee: bigint;         // omni relayer fee, in 3ZLek base units, out of bridged
  feeMint: string;
  version: 1 | 0;
  accounts: number; bytes: number;
  wire: string;             // base64, unsigned by the user. hand to the wallet, then kora signAndSend
};

// intents.near credits whoever the message names: the user's near implicit account (seen on every real transfer, 10 Nov)
export const omniMessage = (r: { user: string; recipient: string }) => r.recipient === 'near:intents.near' ? nearAccountOf(r.user) : '';

export type SwapReq = { user: string; inputMint: string; amount: bigint; recipient: string; feeMint?: string; slippageBps?: number };

const b64len = (s: string) => Math.floor((s.length * 3) / 4) - (s.endsWith('==') ? 2 : s.endsWith('=') ? 1 : 0);
const uniqueAccounts = (payer: string, ixs: Instruction[]) =>
  new Set([payer, ...ixs.flatMap(i => [i.programAddress as string, ...(i.accounts ?? []).map(a => a.address as string)])]).size;

type Blockhash = Parameters<typeof setTransactionMessageLifetimeUsingBlockhash>[0];

// tx v1: kora pays, cu limit + loaded-data cap ride in the message config (no compute-budget ixs)
export const composeV1 = (feePayer: string, bh: Blockhash, ixs: Instruction[]) => compileTransaction(pipe(
  createTransactionMessage({ version: 1 as any }),
  m => setTransactionMessageFeePayer(address(feePayer), m),
  m => setTransactionMessageLifetimeUsingBlockhash(bh, m),
  m => appendTransactionMessageInstructions(ixs, m),
  m => setTransactionMessageConfig({ computeUnitLimit: CU_LIMIT, loadedAccountsDataSizeLimit: 64 * 1024 * 1024 }, m as any),
) as any);

// the omni relayer (bridge-sdk-rs get_transfer_event) resolves init_transfer's token (1), sender (5) and emitter (6)
// from the tx's static keys only. those must never be compressed; entries are masked in place so indices don't shift
const MASK = address('1nc1nerator11111111111111111111111111111111');
export const RELAYER_READS = [1, 5, 6];
type Tables = Awaited<ReturnType<typeof fetchAddressesForLookupTables>>;
export const keepStatic = (tables: Tables, omni: Instruction): Tables => {
  const k = new Set<string>(RELAYER_READS.map(i => omni.accounts![i].address));
  return Object.fromEntries(Object.entries(tables).map(([t, list]) => [t, list.map(a => (k.has(a) ? MASK : a))])) as Tables;
};

const cuLimitIx = (units: number): Instruction => {
  const data = new Uint8Array(5); data[0] = 2; new DataView(data.buffer).setUint32(1, units, true);
  return { programAddress: address(PROGRAMS.computeBudget), accounts: [], data };
};

// tx v0: kora pays, cu limit as a compute-budget ix, jupiter tables compress every account except the omni ix's
export const composeV0 = (feePayer: string, bh: Blockhash, ixs: Instruction[], tables: Tables, omni: Instruction) => compileTransaction(pipe(
  createTransactionMessage({ version: 0 }),
  m => setTransactionMessageFeePayer(address(feePayer), m),
  m => setTransactionMessageLifetimeUsingBlockhash(bh, m),
  m => appendTransactionMessageInstructions([cuLimitIx(CU_LIMIT), ...ixs], m),
  m => compressTransactionMessageUsingAddressLookupTables(m, keepStatic(tables, omni)),
) as any);

// jupiter maxAccounts per try, biggest (best price) first
const ROUTE_SIZES = [JUP_MAX_ACCOUNTS, 30, 26];

export async function buildSwap(cfg: Cfg, r: SwapReq): Promise<SwapPlan> {
  const rpc = createSolanaRpc(cfg.rpc);
  const feeMint = r.feeMint ?? MINTS.usdc;
  const [signer, omniFee] = await Promise.all([payerSigner(cfg.kora), transferFee(r.user, r.recipient, MINTS.near)]);
  // relayer fee paid in the bridged token (taken from the amount), native fee 0 so the user needs no sol.
  // ⚠ token-fee-only relaying is unverified until the funded run
  const relayFee = BigInt(omniFee.transferred_token_fee ?? 0);
  const [userFee, koraFeeAta] = await Promise.all([ata(r.user, feeMint), ata(signer, feeMint)]);
  // jupiter routes vary in size: if a route does not fit, ask for a smaller one
  let tooBig = '';
  for (const max of ROUTE_SIZES) {
    const q = await quote(r.inputMint, MINTS.near, r.amount, r.slippageBps ?? SLIPPAGE_BPS, max);
    const bridged = BigInt(q.otherAmountThreshold);
    const [{ ixs: jup, alts }, { value: bh }] = await Promise.all([swapInstructions(q, r.user, signer), rpc.getLatestBlockhash().send()]);
    const omni = await initTransferIx({ user: r.user, mint: MINTS.near, amount: bridged, recipient: r.recipient, fee: relayFee,
      payer: signer, message: omniMessage(r) });
    const ixsFor = (fee: bigint): Instruction[] => [feeTransferIx(userFee, koraFeeAta, r.user, fee), ...jup, omni];

    const accounts = uniqueAccounts(signer, ixsFor(1n));
    const v1 = async (fee: bigint) => getBase64EncodedWireTransaction(composeV1(signer, bh, ixsFor(fee)));
    let tables: Promise<Tables> | undefined;
    const v0 = async (fee: bigint) => getBase64EncodedWireTransaction(composeV0(signer, bh, ixsFor(fee),
      await (tables ??= fetchAddressesForLookupTables([...alts, ...(STROM_ALT ? [STROM_ALT] : [])].map(a => address(a)) as Address[], rpc)), omni));
    let version: 1 | 0 = cfg.txVersion ?? 0;
    if (version === 1 && (accounts > V1_MAX_ACCOUNTS || b64len(await v1(1n)) > V1_MAX_BYTES)) version = 0;
    const build = version === 1 ? v1 : v0;
    const cap = version === 1 ? V1_MAX_BYTES : V0_MAX_BYTES;
    // the fee is a fixed-width u64, so the size with fee 1 is the final size
    const size = b64len(await build(1n));
    if (size > cap) { tooBig = `${size} bytes (v${version} cap ${cap})`; continue; }

    const koraFee = (await estimateFee(cfg.kora, await build(1n), feeMint)) || FALLBACK_FEE;
    const wire = await build(koraFee);
    const bytes = b64len(wire);
    return { quote: q, route: routeLabel(q), bridged, koraFee, relayFee, feeMint, version, accounts, bytes, wire };
  }
  throw new Error(`tx too big: ${tooBig}. try a smaller amount`);
}
