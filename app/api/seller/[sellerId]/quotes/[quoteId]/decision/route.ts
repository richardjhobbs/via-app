/**
 * POST /api/seller/[sellerId]/quotes/[quoteId]/decision
 *
 * The human approval gate. The buyer-facing agent only ever proposes an
 * advisory number; a quote becomes binding solely through this endpoint.
 *
 * Body: { action: 'approve' | 'revise' | 'reject', total_usdc?, note?, valid_days? }
 *   approve : quote becomes binding. approved_total = total_usdc ?? proposed.
 *             valid_until = now + valid_days (default 14).
 *   revise  : seller proposes a different price (still advisory). Updates
 *             proposed_total, status revised_by_seller. Buyer can counter or
 *             the seller can approve later.
 *   reject  : quote is declined and closed.
 *
 * Every action appends a 'seller' round to the negotiation thread.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireBrandAuth } from '@/lib/app/seller-auth';
import { db } from '@/lib/app/db';

export const dynamic = 'force-dynamic';

type Action = 'approve' | 'revise' | 'reject';

interface DecisionBody {
  action:     Action;
  total_usdc?: number;
  note?:       string;
  valid_days?: number;
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ sellerId: string; quoteId: string }> },
) {
  const { sellerId, quoteId } = await params;
  const auth = await requireBrandAuth(sellerId, 'admin');
  if ('error' in auth) return auth.error;

  let body: DecisionBody;
  try { body = (await req.json()) as DecisionBody; } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  if (!body.action || !['approve', 'revise', 'reject'].includes(body.action)) {
    return NextResponse.json({ error: "action must be 'approve', 'revise', or 'reject'" }, { status: 400 });
  }
  if ((body.action === 'revise') && (typeof body.total_usdc !== 'number' || !isFinite(body.total_usdc) || body.total_usdc < 0)) {
    return NextResponse.json({ error: 'revise requires a non-negative total_usdc' }, { status: 400 });
  }
  if (body.total_usdc !== undefined && (typeof body.total_usdc !== 'number' || !isFinite(body.total_usdc) || body.total_usdc < 0)) {
    return NextResponse.json({ error: 'total_usdc must be a non-negative number' }, { status: 400 });
  }

  const { data: quote, error: readErr } = await db
    .from('app_seller_quotes')
    .select('id, quote_ref, status, proposed_total_usdc, thread')
    .eq('id', quoteId)
    .eq('seller_id', sellerId)
    .maybeSingle();
  if (readErr) return NextResponse.json({ error: readErr.message }, { status: 500 });
  if (!quote) return NextResponse.json({ error: 'Quote not found' }, { status: 404 });
  if (quote.status === 'rejected' || quote.status === 'expired') {
    return NextResponse.json({ error: `Quote is ${quote.status} and cannot be changed.` }, { status: 409 });
  }

  const existingThread = Array.isArray(quote.thread) ? quote.thread as unknown[] : [];
  const now = new Date();
  const proposed = quote.proposed_total_usdc as number | null;

  const update: Record<string, unknown> = {};
  let roundTotal: number | null = null;
  let roundNote = body.note?.trim().slice(0, 1000) || null;

  if (body.action === 'approve') {
    const approvedTotal = body.total_usdc ?? proposed;
    if (approvedTotal == null) {
      return NextResponse.json({ error: 'No proposed total to approve; supply total_usdc.' }, { status: 400 });
    }
    const validDays = Number.isFinite(body.valid_days) && (body.valid_days as number) > 0 ? Math.min(body.valid_days as number, 365) : 14;
    update.status = 'approved';
    update.approved_total_usdc = approvedTotal;
    update.valid_until = new Date(now.getTime() + validDays * 86_400_000).toISOString();
    roundTotal = approvedTotal;
    roundNote = roundNote ?? `Approved at ${approvedTotal} USDC, valid ${validDays} days.`;
  } else if (body.action === 'revise') {
    update.status = 'revised_by_seller';
    update.proposed_total_usdc = body.total_usdc;
    roundTotal = body.total_usdc as number;
    roundNote = roundNote ?? `Seller revised price to ${body.total_usdc} USDC.`;
  } else {
    update.status = 'rejected';
    roundNote = roundNote ?? 'Seller declined this quote.';
  }

  const round = {
    round:      existingThread.length + 1,
    by:         'seller' as const,
    total_usdc: roundTotal,
    note:       roundNote,
    at:         now.toISOString(),
  };
  update.thread = [...existingThread, round];

  const { data, error } = await db
    .from('app_seller_quotes')
    .update(update)
    .eq('id', quoteId)
    .eq('seller_id', sellerId)
    .select('id, quote_ref, status, proposed_total_usdc, approved_total_usdc, valid_until, thread')
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ quote: data });
}
