/**
 * lib/app/x402-gate.ts
 *
 * The brief-door x402 micro-fee gate, settled through the Coinbase CDP x402
 * FACILITATOR. The facilitator verifies the seller's signed EIP-3009
 * transferWithAuthorization and lands the USDC transfer on-chain, SPONSORING the
 * gas. We never hold ETH and never sign a settlement tx , the only way micro-fees
 * scale. (The old self-settle path via PLATFORM_PRIVATE_KEY is gone.)
 *
 *   const gate = await requireX402(req, url, price, 'unlock the full brief');
 *   if (!gate.ok) return gate.response;   // 402 challenge or verify/settle failure
 *   // gate.payment.txHash / payerWallet available
 *
 * Auth to the CDP facilitator is a per-request JWT built from CDP_API_KEY_ID /
 * CDP_API_KEY_SECRET (free tier: 1,000 settlements/month, then $0.001 each).
 */
import { NextResponse } from 'next/server';
import { ethers } from 'ethers';
import { useFacilitator } from 'x402/verify';
import { getAuthHeaders } from '@coinbase/cdp-sdk/auth';
import type { PaymentPayload, PaymentRequirements } from 'x402/types';
import { db } from './db';

export const FEE_UNLOCK_USDC = Number(process.env.VIA_FEE_UNLOCK_USDC ?? '0.005');
export const FEE_OFFER_USDC = Number(process.env.VIA_FEE_OFFER_USDC ?? '0.01');

const USDC_BASE = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const NETWORK = 'base'; // Base mainnet (x402 friendly name; lib maps to eip155:8453)
const FACILITATOR_HOST = 'api.cdp.coinbase.com';
const FACILITATOR_BASE = '/platform/v2/x402';
const FACILITATOR_URL = `https://${FACILITATOR_HOST}${FACILITATOR_BASE}` as const;
const PLATFORM_WALLET = (process.env.NEXT_PUBLIC_PLATFORM_WALLET ?? '0xbfd71eA27FFc99747dA2873372f84346d9A8b7ed');
const BASE_RPC = process.env.NEXT_PUBLIC_BASE_RPC_URL || 'https://mainnet.base.org';
const TRANSFER_TOPIC = ethers.id('Transfer(address,address,uint256)');

/** CDP-authenticated facilitator client (JWT per endpoint). */
function cdpFacilitator() {
  const apiKeyId = process.env.CDP_API_KEY_ID;
  const apiKeySecret = process.env.CDP_API_KEY_SECRET;
  if (!apiKeyId || !apiKeySecret) throw new Error('CDP_API_KEY_ID / CDP_API_KEY_SECRET not configured');
  const auth = (method: string, path: string) =>
    getAuthHeaders({ apiKeyId, apiKeySecret, requestMethod: method, requestHost: FACILITATOR_HOST, requestPath: `${FACILITATOR_BASE}${path}` });
  return useFacilitator({
    url: FACILITATOR_URL,
    createAuthHeaders: async () => ({
      verify:    await auth('POST', '/verify'),
      settle:    await auth('POST', '/settle'),
      supported: await auth('GET', '/supported'),
    }),
  });
}

function paymentRequirements(resourceUrl: string, priceUsdc: number, description: string): PaymentRequirements {
  return {
    scheme:            'exact',
    network:           NETWORK,
    maxAmountRequired: String(Math.round(priceUsdc * 1_000_000)),
    resource:          resourceUrl as `${string}://${string}`,
    description,
    mimeType:          'application/json',
    payTo:             PLATFORM_WALLET,
    maxTimeoutSeconds: 300,
    asset:             USDC_BASE,
    extra:             { name: 'USD Coin', version: '2' }, // USDC EIP-712 domain on Base
  };
}

export type GateOutcome =
  | { ok: true; payment: { txHash: string; payerWallet: string; amountUsdc: number } }
  | { ok: false; response: Response };

/** The two payment options, spelled out in plain language in every 402 body so an
 *  incoming agent can self-select: use an x402 client if it has one, otherwise pay
 *  directly and present the tx hash. */
function paymentOptions(resourceUrl: string, priceUsdc: number) {
  return {
    x402: {
      how: 'If your client speaks x402: send the signed payment receipt in the X-PAYMENT header (base64 PaymentPayload). The CDP facilitator settles it; no gas on your side.',
      header: 'X-PAYMENT',
      accepts_field: 'accepts',
    },
    direct: {
      how: `No x402 client? Send exactly ${priceUsdc} USDC on Base to the payTo address below from any wallet, then retry this same request with header X-PAYMENT-TX set to your transaction hash. One payment unlocks one resource.`,
      header: 'X-PAYMENT-TX',
      pay_to: PLATFORM_WALLET,
      amount_usdc: priceUsdc,
      asset: USDC_BASE,
      asset_symbol: 'USDC',
      network: NETWORK,
    },
  };
}

/** DIRECT-PAY fallback: verify an on-chain USDC transfer (by tx hash) of at least
 *  `priceUsdc` to the platform wallet, then consume the tx so it can't be replayed.
 *  Mirrors the credit top-up verifier. Returns the payer wallet on success. */
async function verifyDirectUsdcPayment(
  txHash: string,
  priceUsdc: number,
  purpose: string,
  resourceUrl: string,
): Promise<{ ok: true; payerWallet: string } | { ok: false; error: string; status: number }> {
  if (!/^0x[0-9a-fA-F]{64}$/.test(txHash)) {
    return { ok: false, error: 'X-PAYMENT-TX must be a 0x transaction hash', status: 402 };
  }

  // Replay guard: a tx hash unlocks exactly once, across all briefs/offers.
  const { data: spent } = await db.from('app_via_micropayments').select('tx_hash').eq('tx_hash', txHash).maybeSingle();
  if (spent) return { ok: false, error: 'this payment has already been used to unlock a resource', status: 402 };

  const provider = new ethers.JsonRpcProvider(BASE_RPC);
  const receipt = await provider.getTransactionReceipt(txHash);
  if (!receipt || receipt.status !== 1) {
    return { ok: false, error: 'transaction not found or not confirmed yet , retry shortly', status: 402 };
  }

  let amountRaw: bigint | null = null;
  let payer = '';
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() === USDC_BASE.toLowerCase() && log.topics[0] === TRANSFER_TOPIC) {
      const to = '0x' + log.topics[2].slice(26);
      if (to.toLowerCase() === PLATFORM_WALLET.toLowerCase()) {
        amountRaw = BigInt(log.data);
        payer = ('0x' + log.topics[1].slice(26)).toLowerCase();
        break;
      }
    }
  }
  if (amountRaw === null) {
    return { ok: false, error: 'no USDC transfer to the platform wallet found in this transaction', status: 402 };
  }
  if (Number(amountRaw) / 1_000_000 < priceUsdc) {
    return { ok: false, error: `payment too small , ${priceUsdc} USDC required`, status: 402 };
  }

  // Consume it. A unique-violation here means a concurrent request already claimed
  // the tx; treat that as replay.
  const { error: insErr } = await db.from('app_via_micropayments').insert({
    tx_hash: txHash, payer_wallet: payer, amount_usdc: Number(amountRaw) / 1_000_000, purpose, resource: resourceUrl,
  });
  if (insErr) return { ok: false, error: 'this payment has already been used to unlock a resource', status: 402 };

  return { ok: true, payerWallet: payer };
}

/** Require a paid x402 micro-fee for this request, settled by the CDP facilitator. */
export async function requireX402(
  req: Request,
  resourceUrl: string,
  priceUsdc: number,
  description: string,
): Promise<GateOutcome> {
  const requirements = paymentRequirements(resourceUrl, priceUsdc, description);
  const purpose = resourceUrl.endsWith('/offer') ? 'brief_offer' : 'brief_unlock';

  const x402Header = req.headers.get('x-payment') ?? req.headers.get('payment-signature');
  const directTxHeader = req.headers.get('x-payment-tx');

  // DIRECT-PAY fallback for agents WITHOUT an x402 client: they sent USDC straight
  // to the platform wallet and present the tx hash. Verified on-chain, consumed once.
  if (directTxHeader) {
    const v = await verifyDirectUsdcPayment(directTxHeader.trim(), priceUsdc, purpose, resourceUrl);
    if (!v.ok) {
      return { ok: false, response: NextResponse.json({ x402Version: 1, error: v.error }, { status: v.status }) };
    }
    return { ok: true, payment: { txHash: directTxHeader.trim(), payerWallet: v.payerWallet, amountUsdc: priceUsdc } };
  }

  // No payment yet -> 402 challenge. We give BOTH the standard x402 `accepts` (for
  // x402-native clients) AND a plain-language `payment_options` block describing the
  // direct-pay path, plus the price in human USDC so a naive reader never misreads
  // the atomic-unit `maxAmountRequired: "10000"` as cents or a ceiling.
  if (!x402Header) {
    return { ok: false, response: NextResponse.json(
      {
        x402Version: 1,
        error: 'payment required',
        price: { amount_usdc: priceUsdc, asset: 'USDC', network: NETWORK, human: `${priceUsdc} USDC` },
        payment_options: paymentOptions(resourceUrl, priceUsdc),
        accepts: [requirements],
      },
      { status: 402 },
    ) };
  }

  let payload: PaymentPayload;
  try { payload = JSON.parse(Buffer.from(x402Header, 'base64').toString('utf8')); }
  catch { return { ok: false, response: NextResponse.json({ x402Version: 1, error: 'malformed X-PAYMENT' }, { status: 402 }) }; }

  // Verify + settle through the facilitator. A structurally-valid-JSON payload that
  // is NOT a well-formed x402 PaymentPayload makes the x402 lib throw; missing CDP
  // creds make cdpFacilitator() throw. Either way it is a payment problem, not a
  // server fault, so we answer with a 402 (+ the standard accepts, so the agent can
  // retry with a correct receipt) rather than letting it surface as a 500.
  try {
    const { verify, settle } = cdpFacilitator();
    const verdict = await verify(payload, requirements);
    if (!verdict.isValid) {
      return { ok: false, response: NextResponse.json(
        { x402Version: 1, error: `payment invalid: ${verdict.invalidReason ?? 'unknown'}`, accepts: [requirements] }, { status: 402 }) };
    }
    const settled = await settle(payload, requirements);
    if (!settled.success || !settled.transaction) {
      return { ok: false, response: NextResponse.json(
        { x402Version: 1, error: `settlement failed: ${settled.errorReason ?? 'unknown'}`, accepts: [requirements] }, { status: 402 }) };
    }
    return { ok: true, payment: { txHash: settled.transaction, payerWallet: (settled.payer ?? '').toLowerCase(), amountUsdc: priceUsdc } };
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'payment verification failed';
    console.error('[x402-gate] verify/settle threw:', msg);
    return { ok: false, response: NextResponse.json(
      { x402Version: 1, error: `payment could not be verified: ${msg}`, accepts: [requirements] }, { status: 402 }) };
  }
}
