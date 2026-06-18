import { NextRequest, NextResponse } from 'next/server';
import { clearBuyerAuthCookies } from '@/lib/app/buyer-auth';

export const dynamic = 'force-dynamic';

// POST /api/buyer/auth/logout — clear buyer auth cookies and send the buyer to
// the login page. 303 so the POST form submission follows as a GET (the sign-out
// buttons in the nav are plain forms, not fetch callers).
export async function POST(req: NextRequest) {
  const response = NextResponse.redirect(new URL('/buyer/login', req.url), 303);
  clearBuyerAuthCookies(response);
  return response;
}
