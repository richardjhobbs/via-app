import { NextRequest, NextResponse } from 'next/server';
import { requireBrandAuth } from '@/lib/app/seller-auth';
import { db } from '@/lib/app/db';

export const dynamic = 'force-dynamic';

/**
 * GET /api/seller/[sellerId]/products
 *   Owner-facing list of every product (active + inactive, drafts +
 *   registered) the seller has created. The public MCP at
 *   /sellers/[slug]/mcp filters for registered + active separately.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ sellerId: string }> },
) {
  const { sellerId } = await params;
  const auth = await requireBrandAuth(sellerId);
  if ('error' in auth) return auth.error;

  const { data, error } = await db
    .from('app_seller_products')
    .select('id, external_id, kind, title, description, price_minor, currency, stock, url, metadata, active, token_id, max_supply, on_chain_status, on_chain_tx_hash, created_at, updated_at')
    .eq('seller_id', sellerId)
    .order('created_at', { ascending: false })
    .limit(200);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ products: data ?? [] });
}

interface CreateBody {
  kind?: 'physical' | 'digital' | 'service';
  title?: string;
  description?: string | null;
  price_usdc?: number;          // human USDC, e.g. 12.50
  stock?: number | null;
  max_supply?: number | null;   // null = unlimited (1e9 sentinel applied at publish)
  url?: string | null;
}

/**
 * POST /api/seller/[sellerId]/products
 *   Create a draft product. on_chain_status defaults to 'draft' per
 *   schema; the publish endpoint flips it to 'registered'.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ sellerId: string }> },
) {
  const { sellerId } = await params;
  const auth = await requireBrandAuth(sellerId);
  if ('error' in auth) return auth.error;

  let body: CreateBody;
  try {
    body = (await req.json()) as CreateBody;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const kind = body.kind;
  if (kind !== 'physical' && kind !== 'digital' && kind !== 'service') {
    return NextResponse.json({ error: 'kind must be physical, digital, or service' }, { status: 400 });
  }
  const title = (body.title ?? '').trim();
  if (title.length < 2 || title.length > 200) {
    return NextResponse.json({ error: 'title must be 2-200 characters' }, { status: 400 });
  }
  if (typeof body.price_usdc !== 'number' || !isFinite(body.price_usdc) || body.price_usdc < 0) {
    return NextResponse.json({ error: 'price_usdc must be a non-negative number' }, { status: 400 });
  }
  const priceMinor = Math.round(body.price_usdc * 1_000_000); // USDC has 6 decimals

  const { data, error } = await db
    .from('app_seller_products')
    .insert({
      seller_id:    sellerId,
      kind,
      title,
      description:  body.description ?? null,
      price_minor:  priceMinor,
      currency:     'USDC',
      stock:        body.stock        ?? null,
      max_supply:   body.max_supply   ?? null,
      url:          body.url          ?? null,
      metadata:     {},
      active:       true,
    })
    .select('id, kind, title, description, price_minor, currency, stock, max_supply, url, active, on_chain_status, created_at')
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ product: data }, { status: 201 });
}
