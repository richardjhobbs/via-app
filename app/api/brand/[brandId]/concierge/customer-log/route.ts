/**
 * POST /api/brand/[slug]/concierge/customer-log
 *
 * Record one communication into the per-(brand, customer) ledger. Backs the
 * Hermes concierge MCP `log_interaction` tool. The concierge calls this on
 * every inbound enquiry and every reply it sends.
 *
 * Write gate: isConciergeAuthorized (superadmin x-admin-secret, or this
 * brand's x-concierge-secret bound to {slug}). ADMIN_READONLY_SECRET is not
 * accepted.
 *
 * Body: { channel, direction, kind, summary, body?, structured?,
 *         wallet?, erc8004?, telegram_user_id?, display_name?, occurred_at? }
 */
import { NextRequest, NextResponse } from 'next/server';
import { isConciergeAuthorized, adminUnauthorized } from '@/lib/rrg/auth';
import { db } from '@/lib/rrg/db';

export const dynamic = 'force-dynamic';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ brandId: string }> },
) {
  const { brandId: slug } = await params;
  if (!(await isConciergeAuthorized(req, slug))) return adminUnauthorized();

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }

  const channel = String(body.channel ?? '');
  const direction = String(body.direction ?? '');
  const kind = String(body.kind ?? '');
  const summary = String(body.summary ?? '').trim();
  if (!channel || !direction || !kind || !summary) {
    return NextResponse.json(
      { error: 'channel, direction, kind, summary are required' },
      { status: 400 },
    );
  }

  const erc8004Raw = body.erc8004;
  const tgRaw = body.telegram_user_id;

  const { data, error } = await db.rpc('rrg_customer_memory_log', {
    p_brand_slug: slug,
    p_channel: channel,
    p_direction: direction,
    p_kind: kind,
    p_summary: summary,
    p_body: body.body != null ? String(body.body) : null,
    p_structured: body.structured && typeof body.structured === 'object' ? body.structured : {},
    p_wallet: body.wallet != null ? String(body.wallet) : null,
    p_erc8004: typeof erc8004Raw === 'number' ? erc8004Raw : (erc8004Raw && /^\d+$/.test(String(erc8004Raw)) ? Number(erc8004Raw) : null),
    p_telegram_user_id: typeof tgRaw === 'number' ? tgRaw : (tgRaw && /^\d+$/.test(String(tgRaw)) ? Number(tgRaw) : null),
    p_display_name: body.display_name != null ? String(body.display_name) : null,
  });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, id: data });
}
