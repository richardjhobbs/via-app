/**
 * Pin a buyer's spend/recognition wallet to their connected in-app wallet.
 *
 * The in-app (thirdweb) wallet is deterministic per email, so it is the single
 * canonical wallet a human buyer transacts from. Onboarding records a snapshot
 * of it, but that snapshot can drift (a different device, a re-onboard). This
 * endpoint lets the client re-pin app_buyers.wallet_address to the wallet that
 * is actually connected, so recognition, purchase attribution, and downloads
 * never key off a stale address.
 *
 * Only fired by the client for the in-app wallet (never an external one), and
 * only for a buyer the caller owns.
 */
import { NextRequest, NextResponse } from 'next/server';
import { ethers } from 'ethers';
import { getBuyerUser, isBuyerOwner } from '@/lib/app/buyer-auth';
import { db } from '@/lib/app/db';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const user = await getBuyerUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  let body: { buyerId?: unknown; wallet?: unknown };
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 }); }

  const buyerId = String(body.buyerId ?? '');
  const wallet  = String(body.wallet ?? '').trim().toLowerCase();
  if (!buyerId)                  return NextResponse.json({ error: 'buyerId required' }, { status: 400 });
  if (!ethers.isAddress(wallet)) return NextResponse.json({ error: 'invalid wallet address' }, { status: 400 });

  if (!(await isBuyerOwner(user.id, buyerId))) {
    return NextResponse.json({ error: 'Not authorized for this buyer' }, { status: 403 });
  }

  const { data: row } = await db
    .from('app_buyers')
    .select('wallet_address')
    .eq('id', buyerId)
    .maybeSingle();
  if (row && (row.wallet_address as string | null)?.toLowerCase() === wallet) {
    return NextResponse.json({ updated: false, wallet });
  }

  const { error } = await db
    .from('app_buyers')
    .update({ wallet_address: wallet, updated_at: new Date().toISOString() })
    .eq('id', buyerId);
  if (error) return NextResponse.json({ error: 'update failed' }, { status: 500 });

  console.log(`[reconcile-wallet] buyer=${buyerId} wallet_address -> ${wallet}`);
  return NextResponse.json({ updated: true, wallet });
}
