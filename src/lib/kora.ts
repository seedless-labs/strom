// kora relayer: pays the solana fee, takes its fee in usdc from the user inside the same tx (ported from p3c).
import { address, AccountRole, type Instruction } from '@solana/kit';
import { PROGRAMS } from './config';

export async function kora<T = any>(url: string, method: string, params: object = {}): Promise<T> {
  const r = await (await fetch(url, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  })).json();
  if (r.error) throw new Error(`kora ${method}: ${r.error.message ?? JSON.stringify(r.error)}`);
  return r.result;
}

export const payerSigner = async (url: string) => (await kora<{ signer_address: string }>(url, 'getPayerSigner')).signer_address;

export const estimateFee = async (url: string, wireB64: string, feeMint: string) =>
  BigInt((await kora<{ fee_in_token?: string | number }>(url, 'estimateTransactionFee', { transaction: wireB64, fee_token: feeMint })).fee_in_token ?? 0);

// kora adds its signature as fee payer and sends. returns the solana signature
export async function signAndSend(url: string, wireB64: string): Promise<string> {
  const r = await kora<{ signature?: string }>(url, 'signAndSendTransaction', { transaction: wireB64 });
  if (!r.signature) throw new Error('kora returned no signature');
  return r.signature;
}

// spl token Transfer (ix 3): user's fee-token account -> kora's
export function feeTransferIx(from: string, to: string, owner: string, amount: bigint): Instruction {
  const data = new Uint8Array(9);
  data[0] = 3;
  new DataView(data.buffer).setBigUint64(1, amount, true);
  return {
    programAddress: address(PROGRAMS.token),
    accounts: [
      { address: address(from), role: AccountRole.WRITABLE },
      { address: address(to), role: AccountRole.WRITABLE },
      { address: address(owner), role: AccountRole.READONLY_SIGNER },
    ],
    data,
  };
}
