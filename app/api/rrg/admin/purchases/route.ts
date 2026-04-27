import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/rrg/db';
import { isAdminFromCookies, adminUnauthorized } from '@/lib/rrg/auth';

export const dynamic = 'force-dynamic';

// GET /api/rrg/admin/purchases?physical=1&limit=50
// Returns recent purchases, optionally filtered to physical products only
export async function GET(req: NextRequest) {
  if (!(await isAdminFromCookies())) return adminUnauthorized();

  const physicalOnly = req.nextUrl.searchParams.get('physical') === '1';
  const limit = Math.min(parseInt(req.nextUrl.searchParams.get('limit') ?? '50'), 200);

  try {
    let query = db
      .from('rrg_purchases')
      .select(`
        id,
        created_at,
        token_id,
        buyer_wallet,
        buyer_email,
        amount_usdc,
        tx_hash,
        download_token,
        shipping_name,
        shipping_address_line1,
        shipping_address_line2,
        shipping_city,
        shipping_state,
        shipping_postal_code,
        shipping_country,
        shipping_phone,
        selected_size,
        brand_id,
        submission_id,
        rrg_submissions!inner (
          title,
          is_physical_product,
          brand_id,
          price_usdc,
          rrg_brands ( name, contact_email, wallet_address, brand_pct_override )
        )
      `)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (physicalOnly) {
      query = query.eq('rrg_submissions.is_physical_product', true);
    }

    const { data, error } = await query;
    if (error) throw error;

    return NextResponse.json({ purchases: data ?? [] });
  } catch (err) {
    console.error('[/api/rrg/admin/purchases]', err);
    return NextResponse.json({ error: 'Failed to fetch purchases' }, { status: 500 });
  }
}
