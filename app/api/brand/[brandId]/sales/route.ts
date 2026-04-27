import { NextRequest, NextResponse } from 'next/server';
import { requireBrandAuth } from '@/lib/rrg/brand-auth';
import { db, getBrandSalesStats } from '@/lib/rrg/db';

export const dynamic = 'force-dynamic';

// GET /api/brand/[brandId]/sales — brand sales + distribution data
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ brandId: string }> }
) {
  const { brandId } = await params;
  const auth = await requireBrandAuth(brandId);
  if ('error' in auth) return auth.error;

  try {
    const stats = await getBrandSalesStats(brandId);

    const { data: rows, error } = await db
      .from('rrg_distributions')
      .select(`
        *,
        rrg_purchases (
          token_id,
          buyer_email,
          shipping_name,
          shipping_country,
          rrg_submissions ( title )
        )
      `)
      .eq('brand_id', brandId)
      .order('created_at', { ascending: false })
      .limit(100);

    if (error) throw error;

    const distributions = (rows ?? []).map((row: Record<string, unknown>) => {
      const purchase = row.rrg_purchases as {
        token_id?: number | null;
        buyer_email?: string | null;
        shipping_name?: string | null;
        shipping_country?: string | null;
        rrg_submissions?: { title?: string | null } | null;
      } | null;
      const { rrg_purchases: _, ...rest } = row;
      return {
        ...rest,
        token_id:         purchase?.token_id        ?? null,
        buyer_email:      purchase?.buyer_email      ?? null,
        shipping_name:    purchase?.shipping_name    ?? null,
        shipping_country: purchase?.shipping_country ?? null,
        submission_title: purchase?.rrg_submissions?.title ?? null,
      };
    });

    return NextResponse.json({ stats, distributions });
  } catch (err) {
    console.error('[/api/brand/[brandId]/sales]', err);
    return NextResponse.json({ error: 'Failed to fetch sales' }, { status: 500 });
  }
}
