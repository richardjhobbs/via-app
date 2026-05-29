/**
 * Delegation caps for a buyer profile.
 *
 *   GET — return the current app_buyers.delegation_caps
 *   PUT — replace the caps after validating shape
 *
 * v1 caps:
 *   max_purchase_usd   number >= 0     single-order ceiling
 *   auto_buy_under_usd number >= 0     orders below this may auto-accept
 *   categories_allowed string[]        allowlist (empty = no allowlist)
 *   categories_blocked string[]        blocklist
 *
 * Auth: the buyer's owner. The caps gate what the per-buyer MCP's
 * accept_offer tool may auto-accept versus queue for human approval.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireBuyerAuth } from '@/lib/app/buyer-auth';
import { db } from '@/lib/app/db';

export const dynamic = 'force-dynamic';

export interface DelegationCaps {
  max_purchase_usd?: number;
  auto_buy_under_usd?: number;
  categories_allowed?: string[];
  categories_blocked?: string[];
}

function parseMoney(value: unknown, field: string): { value?: number } | { error: string } {
  if (value === undefined || value === null || value === '') return {};
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n) || n < 0) return { error: `${field} must be a number >= 0` };
  if (n > 1_000_000_000) return { error: `${field} is unrealistically large` };
  return { value: Math.round(n * 100) / 100 };
}

function parseCategories(value: unknown, field: string): { value?: string[] } | { error: string } {
  if (value === undefined || value === null) return {};
  if (!Array.isArray(value)) return { error: `${field} must be an array of strings` };
  const cleaned = value
    .map((v) => String(v).trim().toLowerCase())
    .filter((v) => v.length > 0 && v.length <= 60);
  if (cleaned.length > 50) return { error: `${field} may hold at most 50 entries` };
  return { value: Array.from(new Set(cleaned)) };
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ buyerId: string }> },
) {
  const { buyerId } = await params;
  const auth = await requireBuyerAuth(buyerId);
  if ('error' in auth) return auth.error;

  const { data, error } = await db
    .from('app_buyers')
    .select('delegation_caps')
    .eq('id', buyerId)
    .single();

  if (error || !data) return NextResponse.json({ error: error?.message ?? 'not found' }, { status: 404 });
  return NextResponse.json({ delegation_caps: (data.delegation_caps ?? {}) as DelegationCaps });
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ buyerId: string }> },
) {
  const { buyerId } = await params;
  const auth = await requireBuyerAuth(buyerId);
  if ('error' in auth) return auth.error;

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 }); }

  const caps: DelegationCaps = {};

  const maxP = parseMoney(body.max_purchase_usd, 'max_purchase_usd');
  if ('error' in maxP) return NextResponse.json({ error: maxP.error }, { status: 400 });
  if (maxP.value !== undefined) caps.max_purchase_usd = maxP.value;

  const autoB = parseMoney(body.auto_buy_under_usd, 'auto_buy_under_usd');
  if ('error' in autoB) return NextResponse.json({ error: autoB.error }, { status: 400 });
  if (autoB.value !== undefined) caps.auto_buy_under_usd = autoB.value;

  if (caps.max_purchase_usd !== undefined && caps.auto_buy_under_usd !== undefined
      && caps.auto_buy_under_usd > caps.max_purchase_usd) {
    return NextResponse.json({ error: 'auto_buy_under_usd cannot exceed max_purchase_usd' }, { status: 400 });
  }

  const allowed = parseCategories(body.categories_allowed, 'categories_allowed');
  if ('error' in allowed) return NextResponse.json({ error: allowed.error }, { status: 400 });
  if (allowed.value !== undefined && allowed.value.length > 0) caps.categories_allowed = allowed.value;

  const blocked = parseCategories(body.categories_blocked, 'categories_blocked');
  if ('error' in blocked) return NextResponse.json({ error: blocked.error }, { status: 400 });
  if (blocked.value !== undefined && blocked.value.length > 0) caps.categories_blocked = blocked.value;

  const { error } = await db
    .from('app_buyers')
    .update({ delegation_caps: caps })
    .eq('id', buyerId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ delegation_caps: caps });
}
