/**
 * Buyer credit top-up , on-chain USDC, mirrors RRG
 * (app/api/agent/[agentId]/credits/topup). The owner sends USDC on Base from
 * their wallet to the platform wallet, then submits the tx hash here. We verify
 * the transfer and credit the USD-equivalent (1 USDC = 1 USD).
 *
 *   GET  , balance + recent ledger (owner only)
 *   POST , { tx_hash } verify a USDC transfer and credit (owner only)
 */
import { NextRequest, NextResponse } from 'next/server';
import { ethers } from 'ethers';
import { requireBuyerAuth } from '@/lib/app/buyer-auth';
import { db } from '@/lib/app/db';
import { topUpCredits, getBalance, getCreditHistory, usdToCredits } from '@/lib/app/buyer-credits';

export const dynamic = 'force-dynamic';

const USDC_ADDRESS = (process.env.NEXT_PUBLIC_USDC_CONTRACT_MAINNET || '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913').toLowerCase();
const PLATFORM_WALLET = process.env.NEXT_PUBLIC_PLATFORM_WALLET ?? '';
const BASE_RPC = process.env.NEXT_PUBLIC_BASE_RPC_URL || 'https://mainnet.base.org';
const TRANSFER_TOPIC = ethers.id('Transfer(address,address,uint256)');

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

  let body: { tx_hash?: unknown };
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 }); }
  const txHash = String(body.tx_hash ?? '').trim();
  if (!/^0x[0-9a-fA-F]{64}$/.test(txHash)) {
    return NextResponse.json({ error: 'A valid transaction hash is required' }, { status: 400 });
  }

  const { data: buyer } = await db
    .from('app_buyers')
    .select('id, wallet_address')
    .eq('id', buyerId)
    .maybeSingle();
  if (!buyer?.wallet_address) {
    return NextResponse.json({ error: 'Buyer wallet not set' }, { status: 400 });
  }

  // Reject a tx hash already credited (idempotency / replay guard).
  const { data: existing } = await db
    .from('app_buyer_credit_transactions')
    .select('id')
    .eq('tx_hash', txHash)
    .maybeSingle();
  if (existing) {
    return NextResponse.json({ error: 'This transaction has already been credited' }, { status: 409 });
  }

  try {
    const provider = new ethers.JsonRpcProvider(BASE_RPC);
    const receipt = await provider.getTransactionReceipt(txHash);
    if (!receipt || receipt.status !== 1) {
      return NextResponse.json({ error: 'Transaction not confirmed or failed' }, { status: 400 });
    }

    let amountRaw: bigint | null = null;
    for (const log of receipt.logs) {
      if (log.address.toLowerCase() === USDC_ADDRESS && log.topics[0] === TRANSFER_TOPIC) {
        const from = '0x' + log.topics[1].slice(26);
        const to   = '0x' + log.topics[2].slice(26);
        if (
          from.toLowerCase() === (buyer.wallet_address as string).toLowerCase() &&
          to.toLowerCase()   === PLATFORM_WALLET.toLowerCase()
        ) {
          amountRaw = BigInt(log.data);
          break;
        }
      }
    }

    if (amountRaw === null) {
      return NextResponse.json(
        { error: 'No USDC transfer found from your wallet to the platform wallet in this transaction' },
        { status: 400 },
      );
    }

    const amountUsd = Number(amountRaw) / 1_000_000; // USDC has 6 decimals; 1 USDC = 1 USD
    if (amountUsd < 0.01) {
      return NextResponse.json({ error: 'Amount too small (minimum $0.01)' }, { status: 400 });
    }

    const newBalance = await topUpCredits(buyerId, amountUsd, txHash, 'USDC top-up');
    return NextResponse.json({
      credited:     amountUsd,
      new_balance:  newBalance,
      credits:      usdToCredits(newBalance),
      tx_hash:      txHash,
    });
  } catch (err) {
    console.error('[buyer/credits/topup]', err);
    return NextResponse.json({ error: 'Failed to verify transaction' }, { status: 500 });
  }
}
