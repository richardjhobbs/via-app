import { NextResponse } from 'next/server';
import { getSellerUser, getUserBrands } from '@/lib/app/seller-auth';
import { db } from '@/lib/app/db';

export const dynamic = 'force-dynamic';

// GET /api/seller/auth/check — validate brand admin session
// Returns active brands for dashboard access, or pending brands for pending screen
export async function GET() {
  try {
    const user = await getSellerUser();
    if (!user) {
      return NextResponse.json({ authenticated: false });
    }

    // Get active brands (existing flow)
    const brands = await getUserBrands(user.id);

    if (brands.length > 0) {
      return NextResponse.json({
        authenticated: true,
        user: { id: user.id, email: user.email },
        brands,
      });
    }

    // No active brands — check for pending brand membership
    const { data: memberships } = await db
      .from('app_seller_members')
      .select(`
        role,
        brand:app_sellers!inner(id, name, slug, status)
      `)
      .eq('user_id', user.id);

    if (memberships && memberships.length > 0) {
      const brandData = memberships[0].brand as unknown as Record<string, unknown>;
      if (brandData.status === 'pending') {
        return NextResponse.json({
          authenticated: true,
          user: { id: user.id, email: user.email },
          brands: [],
          pendingBrand: {
            id:   brandData.id,
            name: brandData.name,
            slug: brandData.slug,
          },
        });
      }
    }

    return NextResponse.json({
      authenticated: true,
      user: { id: user.id, email: user.email },
      brands: [],
    });
  } catch (err) {
    console.error('[/api/seller/auth/check]', err);
    return NextResponse.json({ authenticated: false });
  }
}
