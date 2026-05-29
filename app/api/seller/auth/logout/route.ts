import { NextRequest, NextResponse } from 'next/server';
import { clearBrandAuthCookies } from '@/lib/app/seller-auth';

export const dynamic = 'force-dynamic';

/**
 * POST /api/seller/auth/logout — clear seller auth cookies and send the
 * browser to the app home page. Header form posts trigger a top-level
 * navigation, so a 303 redirect with the cleared cookies attached is
 * the right pattern (matches the admin logout flow).
 */
export async function POST(req: NextRequest) {
  const response = NextResponse.redirect(new URL('/', req.url), 303);
  clearBrandAuthCookies(response);
  return response;
}
