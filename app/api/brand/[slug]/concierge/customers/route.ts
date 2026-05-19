/**
 * GET /api/brand/[slug]/concierge/customers
 *
 * Find customers this brand's concierge has spoken with, matched by name,
 * wallet, ref, or words in past messages. Backs the Hermes concierge MCP
 * `search_customers` tool. Read-only (superadmin or this brand's concierge).
 * Query: q (optional), limit (default 10, max 50).
 */
import { NextRequest, NextResponse } from 'next/server';
import { isConciergeAuthorized, adminUnauthorized } from '@/lib/rrg/auth';
import { db } from '@/lib/rrg/db';

export const dynamic = 'force-dynamic';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  if (!(await isConciergeAuthorized(req, slug))) return adminUnauthorized();

  const url = new URL(req.url);
  const q = url.searchParams.get('q') ?? '';
  const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit') ?? '10', 10) || 10, 1), 50);

  const { data, error } = await db.rpc('rrg_customer_search', {
    p_slug: slug,
    p_query: q,
    p_limit: limit,
  });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ customers: data ?? [] });
}
