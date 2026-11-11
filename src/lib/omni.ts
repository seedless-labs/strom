// omni bridge, solana side. init_transfer is hand-built from the program idl (bridge_token_factory_shim)
// so the browser never loads the node-first omni sdk. scripts/omni-golden.ts checks it byte for byte against the sdk.
import { address, getAddressEncoder, getProgramDerivedAddress, AccountRole, type Address, type Instruction } from '@solana/kit';
import { API, PROGRAMS } from './config';

const enc = new TextEncoder();
const addr = getAddressEncoder();
const pda = async (program: string, seeds: (string | Uint8Array)[]) =>
  (await getProgramDerivedAddress({ programAddress: address(program), seeds: seeds.map(s => typeof s === 'string' ? enc.encode(s) : s) }))[0];

export const ata = (owner: string, mint: string, tokenProgram: string = PROGRAMS.token) =>
  pda(PROGRAMS.ata, [addr.encode(address(owner)) as Uint8Array, addr.encode(address(tokenProgram)) as Uint8Array, addr.encode(address(mint)) as Uint8Array]);

// sha256("global:init_transfer")[0..8], from the idl
const INIT_TRANSFER = Uint8Array.from([174, 50, 134, 99, 122, 243, 243, 224]);

const u64 = (v: bigint) => { const b = new Uint8Array(8); new DataView(b.buffer).setBigUint64(0, v, true); return b; };
const u128 = (v: bigint) => { const b = new Uint8Array(16); const d = new DataView(b.buffer); d.setBigUint64(0, v & 0xffffffffffffffffn, true); d.setBigUint64(8, v >> 64n, true); return b; };
const str = (s: string) => { const t = enc.encode(s); const l = new Uint8Array(4); new DataView(l.buffer).setUint32(0, t.length, true); return [l, t]; };
const cat = (parts: Uint8Array[]) => { const o = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let i = 0; for (const p of parts) { o.set(p, i); i += p.length; } return o; };

export type InitTransfer = {
  user: string;         // signer, owner of the bridged-token account
  payer?: string;       // pays the wormhole message rent; defaults to user (as in p3c)
  mint: string;         // omni-bridged token on solana (3ZLek for near)
  amount: bigint;       // base units moved
  recipient: string;    // 'near:intents.near' style omni address
  fee?: bigint;         // relayer fee in the moved token
  nativeFee?: bigint;   // relayer fee in lamports
  message?: string;
  tokenProgram?: string;
};

export async function initTransferIx(p: InitTransfer): Promise<Instruction> {
  const tokenProgram = p.tokenProgram ?? PROGRAMS.token;
  const config = await pda(PROGRAMS.omni, ['config']);
  const cfgBytes = addr.encode(config) as Uint8Array;
  const [authority, solVault, from, bridge, feeCollector, sequence, message] = await Promise.all([
    pda(PROGRAMS.omni, ['authority']),
    pda(PROGRAMS.omni, ['sol_vault']),
    ata(p.user, p.mint, tokenProgram),
    pda(PROGRAMS.wormhole, ['Bridge']),
    pda(PROGRAMS.wormhole, ['fee_collector']),
    pda(PROGRAMS.wormhole, ['Sequence', cfgBytes]),
    pda(PROGRAMS.wormholeShim, [cfgBytes]),
  ]);
  const R = AccountRole.READONLY, W = AccountRole.WRITABLE, WS = AccountRole.WRITABLE_SIGNER;
  const a = (x: string | Address, role: AccountRole) => ({ address: address(x), role });
  const payer = p.payer ?? p.user;
  return {
    programAddress: address(PROGRAMS.omni),
    // idl account order. vault is an optional account left empty: anchor encodes that as the program id, read-only
    accounts: [
      a(authority, R), a(p.mint, W), a(from, W), a(PROGRAMS.omni, R), a(solVault, W),
      a(p.user, WS),
      a(config, R), a(bridge, W), a(feeCollector, W), a(sequence, W), a(message, W), a(payer, WS),
      a(PROGRAMS.clock, R), a(PROGRAMS.rent, R), a(PROGRAMS.wormhole, R), a(PROGRAMS.system, R),
      a(PROGRAMS.wormholeShim, R), a(PROGRAMS.wormholeShimEa, R),
      a(tokenProgram, R),
    ],
    data: cat([INIT_TRANSFER, u128(p.amount), ...str(p.recipient), u128(p.fee ?? 0n), u64(p.nativeFee ?? 0n), ...str(p.message ?? '')]),
  };
}

// the init_transfer accounts that never change (pdas, sysvars, wormhole). they live in strom's lookup table so the
// v0 tx fits 1232 bytes. never the token (1), sender (5) or config (6): the relayer reads those from static keys
export async function omniConstants(): Promise<Address[]> {
  const config = await pda(PROGRAMS.omni, ['config']);
  const cfgBytes = addr.encode(config) as Uint8Array;
  const pdas = await Promise.all([
    pda(PROGRAMS.omni, ['authority']), pda(PROGRAMS.omni, ['sol_vault']),
    pda(PROGRAMS.wormhole, ['Bridge']), pda(PROGRAMS.wormhole, ['fee_collector']),
    pda(PROGRAMS.wormhole, ['Sequence', cfgBytes]), pda(PROGRAMS.wormholeShim, [cfgBytes]),
  ]);
  return [...pdas, PROGRAMS.clock, PROGRAMS.rent, PROGRAMS.wormhole, PROGRAMS.system, PROGRAMS.wormholeShim, PROGRAMS.wormholeShimEa]
    .map(x => address(x));
}

export type OmniFee = { transferred_token_fee?: string | null; native_token_fee?: string | null; [k: string]: unknown };

export async function transferFee(sender: string, recipient: string, mint: string): Promise<OmniFee> {
  const r = await fetch(`${API.omni}/transfer-fee?sender=sol:${sender}&recipient=${recipient}&token=sol:${mint}`);
  if (!r.ok) throw new Error(`omni transfer-fee ${r.status}`);
  return r.json();
}

// bridge status for a solana init signature. used by the tracker and the agent ("where is my money")
export async function transferStatus(solSignature: string) {
  // the api answers plain-text "Not found" (404) until it indexes the tx
  const res = await fetch(`${API.omni}/transfers/transfer?transaction_hash=${solSignature}`);
  const r = res.ok ? await res.json().catch(() => null) : null;
  const t = Array.isArray(r) ? r[0] : null;
  if (!t) return { found: false as const };
  return {
    found: true as const,
    id: t.id,
    amount: t.transfer_message?.amount as string | undefined,
    recipient: t.transfer_message?.recipient as string | undefined,
    signed: !!t.signed,
    onNear: !!(t.fast_finalised_on_near || t.finalised_on_near),
    finalised: !!t.finalised,
  };
}
