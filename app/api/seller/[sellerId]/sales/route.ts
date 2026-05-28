import { NextRequest, NextResponse } from 'next/server';
import { requireBrandAuth } from '@/lib/app/seller-auth';
import { db, getBrandSalesStats } from '@/lib/app/db';

export const dynamic = 'force-dynamic';

// GET /api/seller/[sellerId]/sales — brand sales + distribution data
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ sellerId: string }> }
) {
  const { sellerId } = await params;
  const auth = await requireBrandAuth(sellerId);
  if ('error' in auth) return auth.error;

  try {
    const stats = await getBrandSalesStats(sellerId);

    const { data: rows, error } = await db
      .from('app_distributions')
      .select(`
        *,
        app_purchases (
          token_id,
          buyer_email,
          shipping_name,
          shipping_country,
          rrg_submissions ( title, is_physical_product )
        )
      `)
      .eq('brand_id', sellerId)
      .order('created_at', { ascending: false })
      .limit(100);

    if (error) throw error;

    const distributions = (rows ?? []).map((row: Record<string, unknown>) => {
      const purchase = row.app_purchases as {
        token_id?: number | null;
        buyer_email?: string | null;
        shipping_name?: string | null;
        shipping_country?: string | null;
        rrg_submissions?: { title?: string | null; is_physical_product?: boolean | null } | null;
      } | null;
      const { app_purchases: _, ...rest } = row;
      return {
        ...rest,
        token_id:           purchase?.token_id              ?? null,
        buyer_email:        purchase?.buyer_email            ?? null,
        shipping_name:      purchase?.shipping_name          ?? null,
        shipping_country:   purchase?.shipping_country       ?? null,
        submission_title:   purchase?.rrg_submissions?.title ?? null,
        is_physical:        purchase?.rrg_submissions?.is_physical_product ?? false,
      };
    });

    return NextResponse.json({ stats, distributions });
  } catch (err) {
    console.error('[/api/seller/[sellerId]/sales]', err);
    return NextResponse.json({ error: 'Failed to fetch sales' }, { status: 500 });
  }
}
