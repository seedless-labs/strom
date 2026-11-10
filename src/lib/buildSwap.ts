// one tx, one user signature: kora fee (usdc) + jupiter swap into omni-bridged near + omni init_transfer to near.
// kora is the fee payer and co-signs + sends. v1 by default (proven p3c); v0 + lookup tables as fallback when v1 caps break.
import {
  address, createSolanaRpc, createTransactionMessage, pipe, setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash, appendTransactionMessageInstructions, compileTransaction,
  getBase64EncodedWireTransaction, setTransactionMessageConfig, fetchAddressesForLookupTables,
  compressTransactionMessageUsingAddressLookupTables, type Instruction, type Address,
} from '@solana/kit';
import { MINTS, CU_LIMIT, SLIPPAGE_BPS, type Cfg } from './config';
import { quote, swapInstructions, routeLabel, type Quote } from './jupiter';
import { initTransferIx, ata, transferFee } from './omni';
import { payerSigner, estimateFee, feeTransferIx } from './kora';

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

export async function buildSwap(cfg: Cfg, r: SwapReq): Promise<SwapPlan> {
  const rpc = createSolanaRpc(cfg.rpc);
  const feeMint = r.feeMint ?? MINTS.usdc;
  const q = await quote(r.inputMint, MINTS.near, r.amount, r.slippageBps ?? SLIPPAGE_BPS);
  const bridged = BigInt(q.otherAmountThreshold);
  const [{ ixs: jup, alts }, signer, { value: bh }, omniFee] = await Promise.all([
    swapInstructions(q, r.user),
    payerSigner(cfg.kora),
    rpc.getLatestBlockhash().send(),
    transferFee(r.user, r.recipient, MINTS.near),
  ]);
  // relayer fee paid in the bridged token (taken from the amount), native fee 0 so the user needs no sol.
  // ⚠ token-fee-only relaying is unverified until the funded run
  const relayFee = BigInt(omniFee.transferred_token_fee ?? 0);
  const omni = await initTransferIx({ user: r.user, mint: MINTS.near, amount: bridged, recipient: r.recipient, fee: relayFee });
  const [userFee, koraFeeAta] = await Promise.all([ata(r.user, feeMint), ata(signer, feeMint)]);
  const ixsFor = (fee: bigint): Instruction[] => [feeTransferIx(userFee, koraFeeAta, r.user, fee), ...jup, omni];

  const v1 = (fee: bigint) => composeV1(signer, bh, ixsFor(fee));

  const accounts = uniqueAccounts(signer, ixsFor(1n));
  let version: 1 | 0 = 1;
  let build = async (fee: bigint) => getBase64EncodedWireTransaction(v1(fee));
  if (accounts > V1_MAX_ACCOUNTS || b64len(await build(1n)) > V1_MAX_BYTES) {
    // fallback: v0 with jupiter lookup tables (default cu limit; v1 carries the 400k config)
    const tables = await fetchAddressesForLookupTables(alts.map(a => address(a)) as Address[], rpc);
    version = 0;
    build = async (fee: bigint) => getBase64EncodedWireTransaction(compileTransaction(pipe(
      createTransactionMessage({ version: 0 }),
      m => setTransactionMessageFeePayer(address(signer), m),
      m => setTransactionMessageLifetimeUsingBlockhash(bh, m),
      m => appendTransactionMessageInstructions(ixsFor(fee), m),
      m => compressTransactionMessageUsingAddressLookupTables(m, tables),
    ) as any));
  }

  const koraFee = (await estimateFee(cfg.kora, await build(1n), feeMint)) || FALLBACK_FEE;
  const wire = await build(koraFee);
  const bytes = b64len(wire);
  const cap = version === 1 ? V1_MAX_BYTES : V0_MAX_BYTES;
  if (bytes > cap) throw new Error(`tx too big: ${bytes} bytes (v${version} cap ${cap}). try a smaller route`);
  return { quote: q, route: routeLabel(q), bridged, koraFee, relayFee, feeMint, version, accounts, bytes, wire };
}
