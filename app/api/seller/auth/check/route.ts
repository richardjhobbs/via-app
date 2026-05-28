import { NextResponse } from 'next/server';
import { getSellerUser, getUserBrands } from '@/lib/app/seller-auth';

export const dynamic = 'force-dynamic';

// GET /api/seller/auth/check — validate seller session, return owned sellers
export async function GET() {
  try {
    const user = await getSellerUser();
    if (!user) {
      return NextResponse.json({ authenticated: false });
    }

    const brands = await getUserBrands(user.id);
    return NextResponse.json({
      authenticated: true,
      user: { id: user.id, email: user.email },
      brands,
    });
  } catch (err) {
    console.error('[/api/seller/auth/check]', err);
    return NextResponse.json({ authenticated: false });
  }
}
