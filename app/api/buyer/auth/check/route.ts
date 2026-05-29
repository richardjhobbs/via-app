import { NextResponse } from 'next/server';
import { getBuyerUser, getUserBuyers } from '@/lib/app/buyer-auth';

export const dynamic = 'force-dynamic';

// GET /api/buyer/auth/check — validate buyer session, return owned profiles
export async function GET() {
  try {
    const user = await getBuyerUser();
    if (!user) {
      return NextResponse.json({ authenticated: false });
    }

    const buyers = await getUserBuyers(user.id);
    return NextResponse.json({
      authenticated: true,
      user: { id: user.id, email: user.email },
      buyers,
    });
  } catch (err) {
    console.error('[/api/buyer/auth/check]', err);
    return NextResponse.json({ authenticated: false });
  }
}
