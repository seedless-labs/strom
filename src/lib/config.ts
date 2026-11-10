// one place for every address and endpoint. values proven in the spikes (p1, p3c, p4).
const env: Record<string, string | undefined> = (import.meta as any).env ?? {};

export const MINTS = {
  usdc: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  sol: 'So11111111111111111111111111111111111111112',
  // near, bridged to solana by the omni bridge
  near: '3ZLekZYq2qkZiSpnSvabjit34tUkjSwD1JFuW9as9wBG',
} as const;

export const DECIMALS = { usdc: 6, sol: 9, near: 9 } as const; // 3ZLek on-chain decimals, checked 10 Nov

export const PROGRAMS = {
  token: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
  ata: 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL',
  system: '11111111111111111111111111111111',
  clock: 'SysvarC1ock11111111111111111111111111111111',
  rent: 'SysvarRent111111111111111111111111111111111',
  // omni bridge locker on solana mainnet
  omni: 'dahPEoZGXfyV58JqqH85okdHmpN8U2q8owgPUXSCPxe',
  wormhole: 'worm2ZoG2kUd4vFXhvjh93UUH596ayRfgQ2MgjNMTth',
  wormholeShim: 'EtZMZM22ViKMo4r5y4Anovs3wKQ2owUmDpjygnMMcdEX',
  wormholeShimEa: 'HQS31aApX3DDkuXgSpV9XyDUNtFgQ31pUn5BNWHG2PSp',
} as const;

export const API = {
  jupiter: 'https://lite-api.jup.ag/swap/v1',
  omni: 'https://mainnet.api.bridge.nearone.org/api/v3',
  nearRpc: 'https://rpc.mainnet.near.org',
} as const;

export type Cfg = { rpc: string; kora: string; nearRecipient: string };

export const defaultCfg: Cfg = {
  rpc: env.VITE_SOLANA_RPC ?? 'https://api.mainnet-beta.solana.com',
  kora: env.VITE_KORA_URL ?? 'http://localhost:8090',
  nearRecipient: env.VITE_NEAR_RECIPIENT ?? 'intents.near',
};

// jupiter route must leave room for omni's ~19 accounts under the v1 64-account cap
export const JUP_MAX_ACCOUNTS = 40;
export const SLIPPAGE_BPS = 50;
export const CU_LIMIT = 400_000;
