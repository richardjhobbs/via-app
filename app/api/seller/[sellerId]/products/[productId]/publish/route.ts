import { NextRequest, NextResponse } from 'next/server';
import { requireBrandAuth } from '@/lib/app/seller-auth';
import { publishProduct } from '@/lib/app/publish-product';

export const dynamic = 'force-dynamic';

/**
 * POST /api/seller/[sellerId]/products/[productId]/publish
 *
 * Dashboard (cookie-auth) entrypoint to mint a product on the VIA ERC-1155
 * contract. The mint logic lives in lib/app/publish-product.ts so this route
 * and the agent-native management MCP share one code path. See that file for
 * the registerDrop / creator=PLATFORM_WALLET payout invariant and the
 * test-mode skip.
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ sellerId: string; productId: string }> },
) {
  const { sellerId, productId } = await params;
  const auth = await requireBrandAuth(sellerId);
  if ('error' in auth) return auth.error;

  const result = await publishProduct(sellerId, productId, auth.user.id);
  if (!result.ok) {
    return NextResponse.json(
      { error: result.error, ...(result.code ? { code: result.code } : {}), ...(result.extra ?? {}) },
      { status: result.status },
    );
  }

  return NextResponse.json({
    product:       result.product,
    token_id:      result.token_id,
    tx_hash:       result.tx_hash,
    chain_skipped: result.chain_skipped,
  });
}
