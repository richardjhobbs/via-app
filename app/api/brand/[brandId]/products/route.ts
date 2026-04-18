import { NextRequest, NextResponse } from 'next/server';
import { requireBrandAuth } from '@/lib/rrg/brand-auth';
import { getApprovedDrops } from '@/lib/rrg/db';

export const dynamic = 'force-dynamic';

// GET /api/brand/[brandId]/products — list brand's approved drops
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ brandId: string }> }
) {
  const { brandId } = await params;
  const auth = await requireBrandAuth(brandId);
  if ('error' in auth) return auth.error;

  try {
    const drops = await getApprovedDrops(brandId);
    return NextResponse.json({ drops });
  } catch (err) {
    console.error('[/api/brand/[brandId]/products]', err);
    return NextResponse.json({ error: 'Failed to fetch products' }, { status: 500 });
  }
}
