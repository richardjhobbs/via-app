/**
 * Buyer credit top-up , gasless. The owner funds their in-app wallet (by card
 * via thirdweb Pay, or by sending USDC on Base to the wallet address), then
 * signs an EIP-2612 USDC permit authorising the platform wallet to pull the
 * amount. The server executes the permit (paying gas) and credits the USD
 * equivalent. The owner never holds ETH and never pastes a transaction hash.
 *
 *   GET   , balance + recent ledger (owner only)
 *   POST  , { x_payment } execute a signed permit and credit (owner only)
 *
 * 1 USDC = 1 USD = 1,000 credits.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireBuyerAuth } from '@/lib/app/buyer-auth';
import { db } from '@/lib/app/db';
import { verifyAndExecutePayment } from '@/lib/app/x402-server';
import { topUpCredits, getBalance, getCreditHistory, usdToCredits } from '@/lib/app/buyer-credits';

export const dynamic = 'force-dynamic';

const PLATFORM_WALLET = process.env.NEXT_PUBLIC_PLATFORM_WALLET ?? '';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ buyerId: string }> },
) {
  const { buyerId } = await params;
  const auth = await requireBuyerAuth(buyerId);
  if ('error' in auth) return auth.error;

  const [balance, history] = await Promise.all([
    getBalance(buyerId),
    getCreditHistory(buyerId, 20),
  ]);
  return NextResponse.json({
    balance_usdc:   balance,
    credits:        usdToCredits(balance),
    platform_wallet: PLATFORM_WALLET,
    history,
  });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ buyerId: string }> },
) {
  const { buyerId } = await params;
  const auth = await requireBuyerAuth(buyerId);
  if ('error' in auth) return auth.error;

  if (!PLATFORM_WALLET) {
    return NextResponse.json({ error: 'Top-up unavailable: platform wallet not configured.' }, { status: 500 });
  }

  let body: { x_payment?: unknown };
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 }); }
  const xPayment = String(body.x_payment ?? '').trim();
  if (!xPayment) {
    return NextResponse.json({ error: 'A signed payment is required' }, { status: 400 });
  }

  // Decode the base64 x402 permit the owner signed client-side.
  let proof;
  try {
    proof = JSON.parse(Buffer.from(xPayment, 'base64').toString('utf-8'));
  } catch {
    return NextResponse.json({ error: 'Could not decode the signed payment' }, { status: 400 });
  }

  // Execute the permit on-chain (platform pays gas, pulls USDC to the platform
  // wallet). Minimum $0.01; the UI recommends >= $10 to minimise card fees.
  const result = await verifyAndExecutePayment(proof, 0.01);
  if (!result.verified || !result.txHash) {
    return NextResponse.json({ error: result.error ?? 'Payment could not be settled' }, { status: 400 });
  }

  // Idempotency: never credit the same settlement twice.
  const { data: existing } = await db
    .from('app_buyer_credit_transactions')
    .select('id')
    .eq('tx_hash', result.txHash)
    .maybeSingle();
  if (existing) {
    return NextResponse.json({ error: 'This payment has already been credited' }, { status: 409 });
  }

  try {
    const newBalance = await topUpCredits(buyerId, result.amountUsdc, result.txHash, 'USDC top-up');
    return NextResponse.json({
      credited:    result.amountUsdc,
      new_balance: newBalance,
      credits:     usdToCredits(newBalance),
      tx_hash:     result.txHash,
    });
  } catch (err) {
    console.error('[buyer/credits/topup]', err);
    return NextResponse.json({ error: 'Settled on-chain but crediting failed; contact support with your tx hash.' }, { status: 500 });
  }
}
