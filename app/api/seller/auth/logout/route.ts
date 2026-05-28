import { NextResponse } from 'next/server';
import { clearBrandAuthCookies } from '@/lib/app/seller-auth';

export const dynamic = 'force-dynamic';

// POST /api/seller/auth/logout — clear brand auth cookies
export async function POST() {
  const response = NextResponse.json({ success: true });
  clearBrandAuthCookies(response);
  return response;
}
