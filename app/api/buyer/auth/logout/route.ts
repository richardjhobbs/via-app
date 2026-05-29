import { NextResponse } from 'next/server';
import { clearBuyerAuthCookies } from '@/lib/app/buyer-auth';

export const dynamic = 'force-dynamic';

// POST /api/buyer/auth/logout — clear buyer auth cookies
export async function POST() {
  const response = NextResponse.json({ success: true });
  clearBuyerAuthCookies(response);
  return response;
}
