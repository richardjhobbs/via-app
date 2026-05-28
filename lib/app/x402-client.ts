/**
 * x402 Outbound Payment Client
 *
 * Handles the x402 payment flow for outgoing requests:
 *   1. Send request → get 402 + Payment-Required header
 *   2. Parse payment requirements (scheme, amount, payTo, asset, network)
 *   3. Sign an EIP-2612 USDC permit authorising payTo to pull the amount
 *   4. Retry the request with Payment-Response header containing the signed permit
 *
 * Uses DEPLOYER_PRIVATE_KEY to sign permits.
 * Cost: typically $0.001 per x402 request (1000 USDC units = 0.001 USDC).
 */

import { ethers } from 'ethers';

// ── Types ──────────────────────────────────────────────────────────────────

interface X402PaymentRequired {
  x402Version: number;
  error: string;
  resource: {
    url: string;
    description?: string;
    mimeType?: string;
  };
  accepts: X402PaymentOption[];
}

interface X402PaymentOption {
  scheme: string;        // "exact" = EIP-2612 permit
  network: string;       // "eip155:8453" = Base mainnet
  amount: string;        // USDC smallest units (e.g. "1000" = 0.001 USDC)
  asset: string;         // USDC contract address
  payTo: string;         // recipient address
  maxTimeoutSeconds: number;
  extra?: {
    name?: string;       // "USD Coin" — for EIP-712 domain
    version?: string;    // "2" — for EIP-712 domain
  };
}

interface X402PaymentResponse {
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

export interface X402Result {
  success: boolean;
  httpStatus: number | null;
  responseBody: string | null;
  amountPaid: string;           // USDC amount paid (human readable, e.g. "0.001")
  payTo: string | null;
  error: string | null;
}

// ── Config ─────────────────────────────────────────────────────────────────

const BASE_CHAIN_ID = 8453;
const BASE_NETWORK = 'eip155:8453';
const USDC_ADDRESS = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const MAX_PAYMENT_USDC = 0.01;  // Safety cap: never pay more than $0.01 per request

// Minimal USDC ABI for nonces + permit domain
const USDC_ABI = [
  'function nonces(address owner) external view returns (uint256)',
  'function name() external view returns (string)',
  'function version() external view returns (string)',
];

const PERMIT_TYPES = {
  Permit: [
    { name: 'owner', type: 'address' },
    { name: 'spender', type: 'address' },
    { name: 'value', type: 'uint256' },
    { name: 'nonce', type: 'uint256' },
    { name: 'deadline', type: 'uint256' },
  ],
};

// ── x402 Payment Flow ──────────────────────────────────────────────────────

/**
 * Send a request to an endpoint. If it returns 402, handle x402 payment
 * and retry with the Payment-Response header.
 *
 * @param url        Target URL
 * @param options    Fetch options (method, headers, body)
 * @param timeoutMs  Request timeout per attempt
 * @returns X402Result with delivery outcome
 */
export async function fetchWithX402(
  url: string,
  options: RequestInit,
  timeoutMs = 10_000,
): Promise<X402Result> {
  const deployerKey = process.env.DEPLOYER_PRIVATE_KEY;
  if (!deployerKey) {
    return {
      success: false,
      httpStatus: null,
      responseBody: null,
      amountPaid: '0',
      payTo: null,
      error: 'DEPLOYER_PRIVATE_KEY not set — cannot sign x402 payments',
    };
  }

  // Step 1: Initial request
  let resp: Response;
  try {
    resp = await fetch(url, {
      ...options,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      httpStatus: null,
      responseBody: null,
      amountPaid: '0',
      payTo: null,
      error: msg.includes('abort') || msg.includes('timeout') ? 'Timeout' : msg,
    };
  }

  // Not a 402 — return the response as-is
  if (resp.status !== 402) {
    const body = await resp.text().catch(() => '');
    return {
      success: resp.ok,
      httpStatus: resp.status,
      responseBody: body.slice(0, 2000),
      amountPaid: '0',
      payTo: null,
      error: resp.ok ? null : `HTTP ${resp.status}`,
    };
  }

  // Step 2: Parse 402 payment requirements
  // Supports three formats:
  //   a) Base64 Payment-Required header (x402 v2 spec)
  //   b) JSON body with x402 object (MoltGuard / v1 style)
  //   c) Base64 X-Payment header (legacy)
  const paymentHeader = resp.headers.get('payment-required')
    ?? resp.headers.get('x-payment-required')
    ?? resp.headers.get('x-payment');

  let paymentReq: X402PaymentRequired | null = null;
  const bodyText = await resp.text().catch(() => '');

  if (paymentHeader) {
    // Header-based: decode base64 JSON
    try {
      paymentReq = JSON.parse(Buffer.from(paymentHeader, 'base64').toString('utf-8'));
    } catch {
      // Try raw JSON (some servers don't base64 encode)
      try { paymentReq = JSON.parse(paymentHeader); } catch { /* handled below */ }
    }
  }

  if (!paymentReq && bodyText) {
    // Body-based: parse JSON body for x402 payment info
    try {
      const bodyJson = JSON.parse(bodyText);
      if (bodyJson.x402?.accepts) {
        // v1 body format: { error: "...", x402: { version, accepts: [...] } }
        paymentReq = {
          x402Version: bodyJson.x402.version ?? 1,
          error: bodyJson.error ?? '',
          resource: { url },
          accepts: bodyJson.x402.accepts.map((a: Record<string, unknown>) => ({
            ...a,
            // Normalise field names: maxAmountRequired → amount
            amount: a.amount ?? a.maxAmountRequired ?? '0',
          })),
        };
      } else if (bodyJson.accepts) {
        // Direct format in body
        paymentReq = {
          x402Version: bodyJson.x402Version ?? 1,
          error: bodyJson.error ?? '',
          resource: bodyJson.resource ?? { url },
          accepts: bodyJson.accepts.map((a: Record<string, unknown>) => ({
            ...a,
            amount: a.amount ?? a.maxAmountRequired ?? '0',
          })),
        };
      }
    } catch {
      // Body isn't JSON — fall through
    }
  }

  if (!paymentReq) {
    return {
      success: false,
      httpStatus: 402,
      responseBody: bodyText.slice(0, 500),
      amountPaid: '0',
      payTo: null,
      error: 'Got 402 but could not parse payment requirements from header or body',
    };
  }

  // Step 3: Find a Base mainnet USDC payment option
  const baseOption = paymentReq.accepts.find(
    (a) => a.network === BASE_NETWORK && a.asset.toLowerCase() === USDC_ADDRESS.toLowerCase(),
  );

  if (!baseOption) {
    // Check if there's any option we could use
    const networks = paymentReq.accepts.map((a) => a.network).join(', ');
    return {
      success: false,
      httpStatus: 402,
      responseBody: null,
      amountPaid: '0',
      payTo: null,
      error: `No Base mainnet USDC payment option. Available: ${networks}`,
    };
  }

  // Step 4: Safety check — don't overpay
  const amountUnits = BigInt(baseOption.amount);
  const amountUsdc = Number(amountUnits) / 1_000_000;
  if (amountUsdc > MAX_PAYMENT_USDC) {
    return {
      success: false,
      httpStatus: 402,
      responseBody: null,
      amountPaid: '0',
      payTo: baseOption.payTo,
      error: `Amount $${amountUsdc} exceeds safety cap of $${MAX_PAYMENT_USDC}`,
    };
  }

  // Step 5: Sign EIP-2612 permit
  let paymentResponse: X402PaymentResponse;
  try {
    paymentResponse = await signX402Permit(deployerKey, baseOption);
  } catch (err) {
    return {
      success: false,
      httpStatus: 402,
      responseBody: null,
      amountPaid: '0',
      payTo: baseOption.payTo,
      error: `Permit signing failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  // Step 6: Retry request with Payment-Response header
  const paymentResponseB64 = Buffer.from(JSON.stringify(paymentResponse)).toString('base64');

  try {
    const retryHeaders = new Headers(options.headers as HeadersInit);
    // Set all known header variants for compatibility
    retryHeaders.set('Payment-Response', paymentResponseB64);
    retryHeaders.set('X-Payment-Response', paymentResponseB64);
    retryHeaders.set('Payment-Signature', paymentResponseB64);  // v2.6 spec name
    retryHeaders.set('X-Payment', paymentResponseB64);          // v1 legacy

    const retryResp = await fetch(url, {
      ...options,
      headers: retryHeaders,
      signal: AbortSignal.timeout(timeoutMs),
    });

    const body = await retryResp.text().catch(() => '');

    return {
      success: retryResp.ok,
      httpStatus: retryResp.status,
      responseBody: body.slice(0, 2000),
      amountPaid: amountUsdc.toFixed(6),
      payTo: baseOption.payTo,
      error: retryResp.ok ? null : `HTTP ${retryResp.status} after payment`,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      httpStatus: null,
      responseBody: null,
      amountPaid: amountUsdc.toFixed(6),
      payTo: baseOption.payTo,
      error: `Retry after payment failed: ${msg}`,
    };
  }
}

// ── Permit Signing ─────────────────────────────────────────────────────────

async function signX402Permit(
  privateKey: string,
  option: X402PaymentOption,
): Promise<X402PaymentResponse> {
  const rpcUrl = process.env.NEXT_PUBLIC_BASE_RPC_URL ?? 'https://mainnet.base.org';
  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const wallet = new ethers.Wallet(privateKey, provider);

  const usdc = new ethers.Contract(USDC_ADDRESS, USDC_ABI, provider);

  // Fetch nonce and domain info
  const [nonce, usdcName, usdcVersion] = await Promise.all([
    usdc.nonces(wallet.address) as Promise<bigint>,
    usdc.name() as Promise<string>,
    usdc.version() as Promise<string>,
  ]);

  // Use domain info from the payment option if available, else from contract
  const domainName = option.extra?.name ?? usdcName;
  const domainVersion = option.extra?.version ?? usdcVersion;

  // 5-minute deadline
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 300);

  const domain = {
    name: domainName,
    version: domainVersion,
    chainId: BASE_CHAIN_ID,
    verifyingContract: USDC_ADDRESS,
  };

  const value = {
    owner: wallet.address,
    spender: option.payTo,
    value: BigInt(option.amount),
    nonce,
    deadline,
  };

  // Sign the EIP-712 typed data
  const signature = await wallet.signTypedData(domain, PERMIT_TYPES, value);

  return {
    scheme: 'exact',
    network: BASE_NETWORK,
    payload: {
      signature,
      authorization: {
        from: wallet.address,
        to: option.payTo,
        value: option.amount,
        validAfter: '0',
        validBefore: deadline.toString(),
        nonce: nonce.toString(),
      },
    },
  };
}
