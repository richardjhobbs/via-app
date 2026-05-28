import { NextRequest, NextResponse } from 'next/server';
import { requireBrandAuth } from '@/lib/app/seller-auth';
import { getApprovedDrops } from '@/lib/app/db';

export const dynamic = 'force-dynamic';

// GET /api/seller/[sellerId]/products — list brand's approved drops
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ sellerId: string }> }
) {
  const { sellerId } = await params;
  const auth = await requireBrandAuth(sellerId);
  if ('error' in auth) return auth.error;

  try {
    const drops = await getApprovedDrops(sellerId);
    return NextResponse.json({ drops });
  } catch (err) {
    console.error('[/api/seller/[sellerId]/products]', err);
    return NextResponse.json({ error: 'Failed to fetch products' }, { status: 500 });
  }
}
