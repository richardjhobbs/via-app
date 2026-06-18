import { NextRequest, NextResponse } from 'next/server';
import { requireBrandAuth } from '@/lib/app/seller-auth';
import { db } from '@/lib/app/db';

export const dynamic = 'force-dynamic';

/**
 * Brand persona = the seller's identity text the Sales Agent reasons with when it
 * decides which buyer briefs to answer and what to offer. Stored on
 * app_sellers.description (+ the shorter headline tagline) and exposed to agents
 * as the standard `brand_persona` field on the seller MCP's list_products. See
 * docs/via-brand-persona.md.
 */

const MAX_PERSONA = 2000;
const MAX_HEADLINE = 200;

/** GET /api/seller/[sellerId]/profile , owner-only read of the persona fields. */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ sellerId: string }> },
) {
  const { sellerId } = await params;
  const auth = await requireBrandAuth(sellerId);
  if ('error' in auth) return auth.error;

  const { data, error } = await db
    .from('app_sellers')
    .select('name, headline, description')
    .eq('id', sellerId)
    .single();
  if (error || !data) return NextResponse.json({ error: 'Seller not found' }, { status: 404 });

  return NextResponse.json({ name: data.name, headline: data.headline ?? '', description: data.description ?? '' });
}

/** PUT /api/seller/[sellerId]/profile , owner-only write of the persona fields. */
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ sellerId: string }> },
) {
  const { sellerId } = await params;
  const auth = await requireBrandAuth(sellerId);
  if ('error' in auth) return auth.error;

  let body: { headline?: unknown; description?: unknown };
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 }); }

  const headline = typeof body.headline === 'string' ? body.headline.trim().slice(0, MAX_HEADLINE) : '';
  const description = typeof body.description === 'string' ? body.description.trim().slice(0, MAX_PERSONA) : '';
  if (!description) return NextResponse.json({ error: 'Brand persona cannot be empty , it is what your Sales Agent uses to match buyer briefs.' }, { status: 400 });

  const { data, error } = await db
    .from('app_sellers')
    .update({ headline: headline || null, description, updated_at: new Date().toISOString() })
    .eq('id', sellerId)
    .select('name, headline, description')
    .single();
  if (error || !data) return NextResponse.json({ error: error?.message ?? 'Update failed' }, { status: 500 });

  return NextResponse.json({ name: data.name, headline: data.headline ?? '', description: data.description ?? '' });
}
