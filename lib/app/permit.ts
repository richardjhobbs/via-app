/**
 * EIP-2612 permit helpers
 *
 * The purchase flow:
 * 1. Server returns permit payload (domain, types, value) to frontend
 * 2. Frontend calls signTypedData via wagmi — buyer signs off-chain
 * 3. Frontend POSTs signature to /api/rrg/confirm
 * 4. Server calls mintWithPermit(tokenId, buyer, deadline, v, r, s)
 * 5. Contract executes permit + split + mint atomically
 */

import { ethers } from 'ethers';

// Domain name/version are fetched live from the USDC contract to avoid
// hardcode mismatches.

export const PERMIT_TYPES = {
  Permit: [
    { name: 'owner',   type: 'address' },
    { name: 'spender', type: 'address' },
    { name: 'value',   type: 'uint256' },
    { name: 'nonce',   type: 'uint256' },
    { name: 'deadline', type: 'uint256' },
  ],
} as const;

export interface PermitPayload {
  domain: {
    name: string;
    version: string;
    chainId: number;
    verifyingContract: string;
  };
  types: typeof PERMIT_TYPES;
  value: {
    owner: string;
    spender: string;
    value: string;       // bigint as string (6dp USDC)
    nonce: string;       // bigint as string
    deadline: string;    // bigint as string
  };
  priceUsdc6dp: string;  // for display
  tokenId: number;
}

// ── Minimal USDC ABI (nonce + EIP-712 domain fields) ──────────────────
const USDC_ABI = [
  'function nonces(address owner) external view returns (uint256)',
  'function name() external view returns (string)',
  'function version() external view returns (string)',
] as const;

export async function buildPermitPayload(
  buyerWallet: string,
  tokenId: number,
  priceUsdc6dp: bigint,
): Promise<PermitPayload> {
  const chainId     = 8453;
  const usdcAddress = process.env.NEXT_PUBLIC_USDC_CONTRACT_MAINNET!;
  const rrgAddress  = process.env.NEXT_PUBLIC_VIA_CONTRACT_ADDRESS!;
  const rpcUrl      = process.env.NEXT_PUBLIC_BASE_RPC_URL!;

  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const usdc     = new ethers.Contract(usdcAddress, USDC_ABI, provider);

  // Fetch nonce, name, and version in parallel directly from the contract
  // so the EIP-712 domain exactly matches what the USDC contract expects.
  const [nonce, usdcName, usdcVersion] = await Promise.all([
    usdc.nonces(buyerWallet) as Promise<bigint>,
    usdc.name()              as Promise<string>,
    usdc.version()           as Promise<string>,
  ]);

  // 10-minute deadline from now
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 600);

  return {
    domain: {
      name:              usdcName,
      version:           usdcVersion,
      chainId,
      verifyingContract: usdcAddress,
    },
    types: PERMIT_TYPES,
    value: {
      owner:    buyerWallet,
      spender:  rrgAddress,
      value:    priceUsdc6dp.toString(),
      nonce:    nonce.toString(),
      deadline: deadline.toString(),
    },
    priceUsdc6dp: priceUsdc6dp.toString(),
    tokenId,
  };
}

// ── Parse a hex signature string into v, r, s ─────────────────────────
export function splitSignature(sig: string): { v: number; r: string; s: string } {
  const { v, r, s } = ethers.Signature.from(sig);
  return { v, r, s };
}
