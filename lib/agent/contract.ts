/**
 * Base mainnet provider, platform signer, and USDC contract helpers.
 * Adapted from rrg/lib/rrg/contract.ts
 */

import { ethers } from 'ethers';

// ── Constants ────────────────────────────────────────────────────────

export const BASE_CHAIN_ID = 8453;
export const USDC_ADDRESS = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
export const PLATFORM_WALLET = (
  process.env.NEXT_PUBLIC_PLATFORM_WALLET ??
  '0xe653804032A2d51Cc031795afC601B9b1fd2c375'
).toLowerCase();

const USDC_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function nonces(address owner) view returns (uint256)',
  'function name() view returns (string)',
  'function permit(address owner, address spender, uint256 value, uint256 deadline, uint8 v, bytes32 r, bytes32 s)',
  'function transferFrom(address from, address to, uint256 amount) returns (bool)',
  'function transfer(address to, uint256 amount) returns (bool)',
] as const;

// ── Provider / Signer ────────────────────────────────────────────────

export function getBaseProvider(): ethers.JsonRpcProvider {
  return new ethers.JsonRpcProvider(
    process.env.NEXT_PUBLIC_BASE_RPC_URL ?? 'https://mainnet.base.org'
  );
}

export function getPlatformSigner(): ethers.Wallet {
  const key = process.env.PLATFORM_PRIVATE_KEY ?? process.env.DEPLOYER_PRIVATE_KEY;
  if (!key) throw new Error('No PLATFORM_PRIVATE_KEY or DEPLOYER_PRIVATE_KEY set');
  return new ethers.Wallet(key, getBaseProvider());
}

// ── USDC helpers ─────────────────────────────────────────────────────

export function getUsdcContract(
  signerOrProvider?: ethers.Signer | ethers.Provider
): ethers.Contract {
  return new ethers.Contract(
    USDC_ADDRESS,
    USDC_ABI,
    signerOrProvider ?? getBaseProvider()
  );
}

/** Returns USDC balance as a human-readable number (6 decimals). */
export async function getUsdcBalance(address: string): Promise<number> {
  const usdc = getUsdcContract();
  const raw: bigint = await usdc.balanceOf(address);
  return Number(raw) / 1_000_000;
}

/** Convert a human-readable USDC amount to 6-decimal raw value. */
export function usdcToRaw(amount: number): bigint {
  return BigInt(Math.round(amount * 1_000_000));
}

/** Convert a 6-decimal raw USDC value to human-readable number. */
export function rawToUsdc(raw: bigint): number {
  return Number(raw) / 1_000_000;
}

/**
 * Read on-chain USDC allowance the agent wallet has granted to a
 * spender. The settlement cron uses this to verify approval exists +
 * has enough headroom before attempting transferFrom.
 */
export async function getUsdcAllowance(
  owner: string,
  spender: string,
): Promise<number> {
  const usdc = getUsdcContract();
  const raw: bigint = await usdc.allowance(owner, spender);
  return Number(raw) / 1_000_000;
}

/**
 * Server-side settlement transfer. The platform signer (typically the
 * PLATFORM/DEPLOYER key) calls USDC.transferFrom to pull `amount` from
 * the agent wallet into `to`. The agent wallet must have a sufficient
 * approval granted to the signer's address (or the PLATFORM_WALLET if
 * we use a different signer than the recipient).
 *
 * Throws on revert (insufficient allowance, insufficient balance, etc.).
 * Returns the on-chain transaction hash on success.
 */
export async function transferUsdcFromAgent(
  fromAgentWallet: string,
  to: string,
  amount: number,
): Promise<string> {
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error(`transferUsdcFromAgent: invalid amount ${amount}`);
  }
  const signer = getPlatformSigner();
  const usdc = getUsdcContract(signer);
  const raw = usdcToRaw(amount);
  const tx = await usdc.transferFrom(fromAgentWallet, to, raw);
  const receipt = await tx.wait();
  return receipt?.hash ?? tx.hash;
}
