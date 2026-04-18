import { NextRequest, NextResponse } from 'next/server';
import { getDropByTokenId } from '@/lib/rrg/db';
import { buildPermitPayload } from '@/lib/rrg/permit';
import { toUsdc6dp } from '@/lib/rrg/contract';

export const dynamic = 'force-dynamic';

// POST /api/rrg/purchase — public: return permit payload for buyer to sign
// Body: { tokenId, buyerWallet }
export async function POST(req: NextRequest) {
  try {
    const { tokenId, buyerWallet } = await req.json();

    if (!tokenId || isNaN(parseInt(tokenId))) {
      return NextResponse.json({ error: 'tokenId required' }, { status: 400 });
    }
    if (!buyerWallet || !/^0x[0-9a-f]{40}$/i.test(buyerWallet)) {
      return NextResponse.json({ error: 'Valid buyer wallet required' }, { status: 400 });
    }

    const drop = await getDropByTokenId(parseInt(tokenId));
    if (!drop) {
      return NextResponse.json({ error: 'Drop not found' }, { status: 404 });
    }
    if (!drop.price_usdc) {
      return NextResponse.json({ error: 'Drop price not set' }, { status: 400 });
    }

    const priceUsdc    = parseFloat(drop.price_usdc);
    const priceUsdc6dp = toUsdc6dp(priceUsdc);

    const permitPayload = await buildPermitPayload(
      buyerWallet,
      parseInt(tokenId),
      priceUsdc6dp,
    );

    return NextResponse.json({
      permitPayload,
      drop: {
        tokenId:     drop.token_id,
        title:       drop.title,
        priceUsdc,
        editionSize: drop.edition_size,
      },
    });
  } catch (err) {
    console.error('[/api/rrg/purchase]', err);
    return NextResponse.json({ error: 'Failed to build permit payload' }, { status: 500 });
  }
}
