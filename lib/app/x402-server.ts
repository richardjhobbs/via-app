/**
 * x402 Inbound Payment Server
 *
 * Verifies incoming x402 payment proofs (EIP-2612 USDC permits on Base)
 * and executes them on-chain to pull funds from the buyer.
 *
 * Flow:
 *   1. Agent sends GET with Payment-Response header (base64 JSON)
 *   2. Parse the permit: { from, to, value, nonce, deadline, signature }
 *   3. Verify: to == platform wallet, value >= price, deadline > now
 *   4. Recover signer from EIP-712 typed data to confirm from matches
 *   5. Execute permit on-chain (USDC.permit) then transferFrom to pull funds
 *   6. Return { verified: true, buyerWallet, amountUsdc, txHash }
 *
 * Uses PLATFORM_PRIVATE_KEY to call permit() + transferFrom() on USDC.
 */

import { ethers } from 'ethers';

// ── Types (mirrors x402-client.ts) ──────────────────────────────────────────

interface X402PaymentPayload {
  scheme: string;
  network: string;
  payload: {
    signature: string;
    authorization: {
      from: string;
      to: string;
      value: string;
      validAfter: string;
      validBefore: string;
      nonce: string;
    };
  };
}

export interface X402VerifyResult {
  verified: boolean;
  buyerWallet: string | null;
  amountUsdc: number;
  txHash: string | null;
  error: string | null;
}

// ── Config ─────────────────────────────────────────────────────────────────

const BASE_CHAIN_ID = 8453;
const USDC_ADDRESS  = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const PLATFORM_WALLET = (
  process.env.NEXT_PUBLIC_PLATFORM_WALLET ||
  '0xbfd71eA27FFc99747dA2873372f84346d9A8b7ed'
).toLowerCase();

const USDC_ABI = [
  'function permit(address owner, address spender, uint256 value, uint256 deadline, uint8 v, bytes32 r, bytes32 s)',
  'function transferFrom(address from, address to, uint256 amount) returns (bool)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function nonces(address owner) view returns (uint256)',
  'function name() view returns (string)',
  'function version() view returns (string)',
];

const PERMIT_TYPES = {
  Permit: [
    { name: 'owner',   type: 'address' },
    { name: 'spender', type: 'address' },
    { name: 'value',   type: 'uint256' },
    { name: 'nonce',   type: 'uint256' },
    { name: 'deadline', type: 'uint256' },
  ],
};

// ── Extract payment header ──────────────────────────────────────────────────

/**
 * Extract x402 payment proof from request headers.
 * Supports: Payment-Response, X-Payment-Response, X-Payment (base64 or raw JSON)
 */
export function extractPaymentProof(headers: Headers): X402PaymentPayload | null {
  const raw =
    headers.get('payment-response') ??
    headers.get('x-payment-response') ??
    headers.get('payment-signature') ??
    headers.get('x-payment');

  if (!raw) return null;

  try {
    // Try base64 first
    const decoded = Buffer.from(raw, 'base64').toString('utf-8');
    return JSON.parse(decoded) as X402PaymentPayload;
  } catch {
    // Try raw JSON
    try {
      return JSON.parse(raw) as X402PaymentPayload;
    } catch {
      return null;
    }
  }
}

// ── Build 402 challenge response ────────────────────────────────────────────

export function build402Challenge(
  url: string,
  priceUsdc: number,
  description: string,
): {
  status: 402;
  body: Record<string, unknown>;
  headers: Record<string, string>;
} {
  const amountUnits = Math.round(priceUsdc * 1_000_000).toString();

  const body = {
    x402Version: 1,
    error: 'Payment required',
    resource: { url, description },
    accepts: [
      {
        scheme:            'exact',
        network:           `eip155:${BASE_CHAIN_ID}`,
        amount:            amountUnits,
        asset:             USDC_ADDRESS,
        payTo:             PLATFORM_WALLET,
        maxTimeoutSeconds: 300,
        extra: { name: 'USD Coin', version: '2' },
      },
    ],
  };

  const headerValue = Buffer.from(JSON.stringify(body)).toString('base64');

  return {
    status: 402,
    body,
    headers: { 'Payment-Required': headerValue },
  };
}

// ── Verify + execute payment ────────────────────────────────────────────────

/**
 * Verify an x402 payment proof and execute the permit on-chain.
 *
 * @param proof     Parsed payment proof from headers
 * @param minUsdc   Minimum payment amount (drop price)
 * @returns         Verification result with buyer wallet and tx hash
 */
export async function verifyAndExecutePayment(
  proof: X402PaymentPayload,
  minUsdc: number,
): Promise<X402VerifyResult> {
  const { authorization, signature } = proof.payload;

  // ── Basic validation ─────────────────────────────────────────────────
  if (authorization.to.toLowerCase() !== PLATFORM_WALLET) {
    return {
      verified:    false,
      buyerWallet: authorization.from,
      amountUsdc:  0,
      txHash:      null,
      error:       `Payment recipient mismatch: expected ${PLATFORM_WALLET}, got ${authorization.to}`,
    };
  }

  const amountUnits = BigInt(authorization.value);
  const amountUsdc  = Number(amountUnits) / 1_000_000;

  if (amountUsdc < minUsdc) {
    return {
      verified:    false,
      buyerWallet: authorization.from,
      amountUsdc,
      txHash:      null,
      error:       `Insufficient payment: $${amountUsdc} < $${minUsdc} required`,
    };
  }

  const deadline = BigInt(authorization.validBefore || '0');
  const now      = BigInt(Math.floor(Date.now() / 1000));
  if (deadline <= now) {
    return {
      verified:    false,
      buyerWallet: authorization.from,
      amountUsdc,
      txHash:      null,
      error:       'Payment permit has expired',
    };
  }

  // ── Recover signer from EIP-712 signature ────────────────────────────
  try {
    const domain = {
      name:              'USD Coin',
      version:           '2',
      chainId:           BASE_CHAIN_ID,
      verifyingContract: USDC_ADDRESS,
    };

    const value = {
      owner:    authorization.from,
      spender:  authorization.to,
      value:    BigInt(authorization.value),
      nonce:    BigInt(authorization.nonce),
      deadline,
    };

    const recovered = ethers.verifyTypedData(domain, PERMIT_TYPES, value, signature);

    if (recovered.toLowerCase() !== authorization.from.toLowerCase()) {
      return {
        verified:    false,
        buyerWallet: authorization.from,
        amountUsdc,
        txHash:      null,
        error:       `Signature mismatch: recovered ${recovered}, expected ${authorization.from}`,
      };
    }
  } catch (err) {
    return {
      verified:    false,
      buyerWallet: authorization.from,
      amountUsdc,
      txHash:      null,
      error:       `Signature verification failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  // ── Execute permit on-chain ──────────────────────────────────────────
  const platformKey = process.env.PLATFORM_PRIVATE_KEY;
  if (!platformKey) {
    return {
      verified:    false,
      buyerWallet: authorization.from,
      amountUsdc,
      txHash:      null,
      error:       'PLATFORM_PRIVATE_KEY not configured — cannot execute permit',
    };
  }

  const rpcUrl   = process.env.NEXT_PUBLIC_BASE_RPC_URL ?? 'https://mainnet.base.org';
  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const wallet   = new ethers.Wallet(platformKey, provider);
  const usdc     = new ethers.Contract(USDC_ADDRESS, USDC_ABI, wallet);

  try {
    // Split signature into v, r, s
    const sig = ethers.Signature.from(signature);

    // Call USDC.permit to set allowance
    const permitTx = await usdc.permit(
      authorization.from,   // owner
      authorization.to,     // spender (platform wallet)
      BigInt(authorization.value),
      deadline,
      sig.v,
      sig.r,
      sig.s,
    );
    await permitTx.wait(1);

    // Call transferFrom to pull funds
    const transferTx = await usdc.transferFrom(
      authorization.from,   // from (buyer)
      authorization.to,     // to (platform wallet)
      BigInt(authorization.value),
    );
    const receipt = await transferTx.wait(1);

    return {
      verified:    true,
      buyerWallet: authorization.from.toLowerCase(),
      amountUsdc,
      txHash:      receipt.hash,
      error:       null,
    };
  } catch (err) {
    return {
      verified:    false,
      buyerWallet: authorization.from,
      amountUsdc,
      txHash:      null,
      error:       `On-chain permit/transfer failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}
