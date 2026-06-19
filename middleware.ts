import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// Two jobs in this middleware:
//
// 1. Markdown content negotiation for agents on `/` (Accept: text/markdown).
// 2. Seller/buyer session keep-alive: silently refresh the Supabase session
//    and re-persist the rotated cookies so a logged-in operator is NOT kicked
//    out when the 1-hour access token expires. Without this, the access token
//    dies after an hour, the one-shot in-memory refresh in getSellerUser threw
//    the rotated token away, and refresh-token rotation then revoked the whole
//    session on the next request, forcing a fresh password login.

const ACCESS_TOKEN_COOKIE  = 'sb-access-token';
const REFRESH_TOKEN_COOKIE = 'sb-refresh-token';
const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  path: '/',
  maxAge: 60 * 60 * 24 * 7, // 7 days
};

// Refresh when the access token is expired or within this window of expiring,
// so we never serve a request on a token that dies mid-navigation.
const REFRESH_SKEW_SECONDS = 5 * 60;

/** Decode a JWT's `exp` (seconds since epoch) without verifying the signature. */
function jwtExp(token: string): number | null {
  try {
    const payload = token.split('.')[1];
    if (!payload) return null;
    const json = atob(payload.replace(/-/g, '+').replace(/_/g, '/'));
    const claims = JSON.parse(json) as { exp?: number };
    return typeof claims.exp === 'number' ? claims.exp : null;
  } catch {
    return null;
  }
}

async function withSessionRefresh(req: NextRequest): Promise<NextResponse> {
  const accessToken  = req.cookies.get(ACCESS_TOKEN_COOKIE)?.value;
  const refreshToken = req.cookies.get(REFRESH_TOKEN_COOKIE)?.value;

  // Not a logged-in request, or no way to refresh: pass straight through.
  if (!accessToken || !refreshToken) return NextResponse.next();

  // Cheap local check: only hit Supabase when the token is at/near expiry.
  const exp = jwtExp(accessToken);
  const now = Math.floor(Date.now() / 1000);
  if (exp && exp - now > REFRESH_SKEW_SECONDS) return NextResponse.next();

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '',
    { auth: { autoRefreshToken: false, persistSession: false } },
  );

  const { data, error } = await supabase.auth.refreshSession({ refresh_token: refreshToken });

  // Refresh failed (token truly dead or revoked): leave cookies as-is and let
  // the downstream auth check decide. Don't clobber a session we can't replace.
  if (error || !data.session) return NextResponse.next();

  const newAccess  = data.session.access_token;
  const newRefresh = data.session.refresh_token;

  // Forward the fresh tokens to the page (RSC reads req cookies) ...
  req.cookies.set(ACCESS_TOKEN_COOKIE, newAccess);
  req.cookies.set(REFRESH_TOKEN_COOKIE, newRefresh);
  const res = NextResponse.next({ request: req });
  // ... and send them to the browser.
  res.cookies.set(ACCESS_TOKEN_COOKIE, newAccess, COOKIE_OPTIONS);
  res.cookies.set(REFRESH_TOKEN_COOKIE, newRefresh, COOKIE_OPTIONS);
  return res;
}

export async function middleware(req: NextRequest) {
  const pathname = req.nextUrl.pathname;

  // ── Markdown negotiation, only on the home page ──
  if (pathname === '/') {
    const accept = req.headers.get('accept') || '';
    if (accept.toLowerCase().includes('text/markdown')) {
      const md = homeMarkdown();
      return new NextResponse(md, {
        headers: {
          'content-type': 'text/markdown; charset=utf-8',
          'cache-control': 'public, max-age=3600',
          'x-markdown-tokens': String(Math.ceil(md.length / 4)),
          vary: 'Accept',
        },
      });
    }
    return NextResponse.next();
  }

  // ── Session keep-alive for authenticated surfaces ──
  return withSessionRefresh(req);
}

export const config = {
  matcher: [
    '/',
    '/seller/:path*',
    '/buyer/:path*',
    '/api/seller/:path*',
    '/api/buyer/:path*',
    '/api/notifications/:path*',
  ],
};

function homeMarkdown(): string {
  return `# VIA

Agentic commerce network. Sellers expose a Sales Agent over MCP; buyers train a
Buying Agent that discovers products, negotiates, and pays in USDC on Base.

## For agents

- **MCP endpoint:** https://app.getvia.xyz/mcp
- **Agent card:** https://app.getvia.xyz/.well-known/agent-card.json
- **MCP server card:** https://app.getvia.xyz/.well-known/mcp/server-card.json
- **Agent skills:** https://app.getvia.xyz/.well-known/agent-skills/index.json
- **API catalog:** https://app.getvia.xyz/.well-known/api-catalog
- **Auth (agents):** https://app.getvia.xyz/auth.md

## What you can do

- \`find_seller\`, search the network for products matching a buyer intent
- \`list_sellers\`, browse every seller on the network
- \`get_seller_products\`, drill into one seller's matching products
- \`register_store\`, onboard a seller with an ERC-8004 identity
- \`submit_intent\`, broadcast a buying intent to seller agents

Per-seller MCP: https://app.getvia.xyz/sellers/{slug}/mcp
Per-buyer MCP: https://app.getvia.xyz/buyers/{handle}/mcp

## Payment

USDC on Base (\`0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913\`), settled via x402.
Brand split is 97.5% seller / 2.5% platform.

## Operated by

[VIA Labs](https://www.getvia.xyz)
`;
}
