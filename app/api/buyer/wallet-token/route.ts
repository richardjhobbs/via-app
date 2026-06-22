/**
 * Mint a short-lived JWT that lets a logged-in buyer's browser silently connect
 * their OWN thirdweb in-app wallet at checkout (custom JWT / OIDC strategy), so
 * they never see a wallet chooser or email OTP. Gated by the buyer's VIA session.
 *
 * `sub` = the buyer's auth email (lowercased): the same identifier their
 * email/Google-created wallet is keyed by, so thirdweb resolves the JWT to that
 * SAME funded wallet. `expected_wallet` is returned so the client can assert the
 * connected address matches the buyer's funding wallet (and surface a mismatch
 * rather than silently using a new empty wallet).
 */
import { NextResponse } from 'next/server';
import { getBuyerUser } from '@/lib/app/buyer-auth';
import { db } from '@/lib/app/db';
import { signBuyerWalletJwt } from '@/lib/app/wallet-jwt';

export const dynamic = 'force-dynamic';

export async function GET() {
  const user = await getBuyerUser();
  if (!user) return NextResponse.json({ error: 'not authenticated' }, { status: 401 });
  if (!user.email) return NextResponse.json({ error: 'no email on account' }, { status: 409 });

  // One owner can hold more than one buyer profile; take the primary (oldest) so
  // a second profile (e.g. the NOSTR inbound system buyer) does not null this out.
  const { data: buyers } = await db
    .from('app_buyers')
    .select('wallet_address, created_at')
    .eq('owner_user_id', user.id)
    .order('created_at', { ascending: true })
    .limit(1);
  const buyer = buyers?.[0];
  if (!buyer) return NextResponse.json({ error: 'no buyer profile' }, { status: 404 });

  const email = user.email.toLowerCase();
  const jwt = signBuyerWalletJwt({ sub: email, email });
  if (!jwt) return NextResponse.json({ error: 'wallet auth not configured' }, { status: 503 });

  return NextResponse.json({ jwt, expected_wallet: (buyer.wallet_address as string | null) ?? null });
}
