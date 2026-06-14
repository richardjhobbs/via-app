/**
 * Buying intents for a buyer profile.
 *
 *   GET    — list this buyer's intents (newest first)
 *   POST   — create an open intent { intent_text, structured? }
 *   DELETE — cancel an intent { id } (sets status='cancelled')
 *
 * Auth: the buyer's owner. Writes go through the service-role db client,
 * so ownership is enforced here, not by RLS.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireBuyerAuth } from '@/lib/app/buyer-auth';
import { db } from '@/lib/app/db';
import { matchIntent, extractIntent } from '@/lib/app/buyer-matching';
import { hasCredits, deductCredits } from '@/lib/app/buyer-credits';

const INSUFFICIENT = {
  error: 'Out of credits. Top up, or connect your own LLM key, to keep sourcing briefs.',
  code: 'insufficient_credits',
} as const;

export const dynamic = 'force-dynamic';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ buyerId: string }> },
) {
  const { buyerId } = await params;
  const auth = await requireBuyerAuth(buyerId);
  if ('error' in auth) return auth.error;

  const { data, error } = await db
    .from('app_buyer_intents')
    .select('id, intent_text, structured, status, broadcast_at, resolved_at, created_at')
    .eq('buyer_id', buyerId)
    .order('created_at', { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ intents: data ?? [] });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ buyerId: string }> },
) {
  const { buyerId } = await params;
  const auth = await requireBuyerAuth(buyerId);
  if ('error' in auth) return auth.error;

  let body: { intent_text?: unknown; structured?: unknown; preview?: unknown };
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 }); }

  const intentText = String(body.intent_text ?? '').trim();
  if (intentText.length < 3 || intentText.length > 2000) {
    return NextResponse.json({ error: 'intent_text must be 3 to 2000 characters' }, { status: 400 });
  }

  // Sourcing a brief always spends platform DeepSeek (extract + judge), even for
  // BYO buyers , the matcher never uses the buyer's own key. Gate on credits so a
  // spent buyer is blocked cleanly rather than driven negative.
  if (!(await hasCredits(buyerId))) {
    return NextResponse.json(INSUFFICIENT, { status: 402 });
  }

  // PREVIEW mode: distil the brief into a structured intent and return it for the
  // owner to review/edit BEFORE anything is persisted or searched. No DB write,
  // no match run. The confirm step (no preview flag) posts the edited intent back
  // as structured.search_intent, which matchIntent reuses verbatim.
  if (body.preview === true) {
    const meter = { tokens: 0 };
    const search_intent = await extractIntent(intentText, meter);
    if (meter.tokens > 0) {
      try { await deductCredits(buyerId, meter.tokens, 'brief preview'); } catch (e) { console.error('[intents] preview meter failed:', e); }
    }
    return NextResponse.json({ preview: true, intent_text: intentText, search_intent });
  }

  const structured = body.structured && typeof body.structured === 'object' && !Array.isArray(body.structured)
    ? (body.structured as Record<string, unknown>)
    : {};

  const { data, error } = await db
    .from('app_buyer_intents')
    .insert({ buyer_id: buyerId, intent_text: intentText, structured, status: 'open' })
    .select('id, intent_text, structured, status, broadcast_at, resolved_at, created_at')
    .single();

  if (error || !data) return NextResponse.json({ error: error?.message ?? 'insert failed' }, { status: 500 });

  // Source the brief immediately: run it through the catalogue and persist any
  // matches. Non-fatal , a matching hiccup must not fail intent creation.
  let matches = { found: 0, inserted: 0 };
  try {
    matches = await matchIntent({
      id:          data.id as string,
      buyer_id:    buyerId,
      intent_text: data.intent_text as string,
      status:      data.status as string,
      structured:  data.structured as Record<string, unknown> | null,
    });
  } catch (e) {
    console.error('[intents] initial match failed:', e);
  }

  return NextResponse.json({ intent: data, matches }, { status: 201 });
}

/**
 * Brief actions:
 *   action='reinstate' , a cancelled brief back to 'open' (within the 24h grace
 *                        window before cleanup), then re-source it.
 *   action='rematch'   , re-run an active brief against the live network now
 *                        (reuses the cached intent; picks up new catalogue +
 *                        engine improvements without recreating the brief).
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ buyerId: string }> },
) {
  const { buyerId } = await params;
  const auth = await requireBuyerAuth(buyerId);
  if ('error' in auth) return auth.error;

  let body: { id?: unknown; action?: unknown; value?: unknown };
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 }); }
  const id = String(body.id ?? '');
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });
  const action = body.action;
  if (action !== 'reinstate' && action !== 'rematch' && action !== 'set_discoverable') {
    return NextResponse.json({ error: 'unsupported action' }, { status: 400 });
  }

  // Toggle whether this brief is visible to seller agents (demand discovery).
  if (action === 'set_discoverable') {
    const value = body.value !== false;
    const { data, error } = await db
      .from('app_buyer_intents')
      .update({ discoverable: value })
      .eq('id', id).eq('buyer_id', buyerId)
      .select('id, discoverable')
      .maybeSingle();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!data) return NextResponse.json({ error: 'brief not found' }, { status: 404 });
    return NextResponse.json({ intent: data });
  }

  // reinstate / rematch both re-source the brief (extract + judge), so they spend
  // platform DeepSeek. Gate on credits before doing the work.
  if (!(await hasCredits(buyerId))) {
    return NextResponse.json(INSUFFICIENT, { status: 402 });
  }

  const COLS = 'id, intent_text, structured, status, broadcast_at, resolved_at, created_at';
  type BriefLite = { id: string; intent_text: string; structured: Record<string, unknown> | null; status: string };
  let row: BriefLite | null = null;

  if (action === 'reinstate') {
    // Reinstate a cancelled brief back to open (24h grace window before cleanup).
    const upd = await db
      .from('app_buyer_intents')
      .update({ status: 'open', resolved_at: null })
      .eq('id', id).eq('buyer_id', buyerId).eq('status', 'cancelled')
      .select(COLS)
      .maybeSingle();
    if (upd.error) return NextResponse.json({ error: upd.error.message }, { status: 500 });
    if (!upd.data) return NextResponse.json({ error: 'brief not found or not cancelled' }, { status: 404 });
    row = upd.data as unknown as BriefLite;
  } else {
    // Rematch an active brief: re-run it against the live network now.
    const sel = await db
      .from('app_buyer_intents')
      .select(COLS)
      .eq('id', id).eq('buyer_id', buyerId).in('status', ['open', 'broadcast', 'matched'])
      .maybeSingle();
    if (sel.error) return NextResponse.json({ error: sel.error.message }, { status: 500 });
    if (!sel.data) return NextResponse.json({ error: 'brief not found or not active' }, { status: 404 });
    row = sel.data as unknown as BriefLite;
  }

  // Re-source against the live network now; non-fatal.
  let matches = { found: 0, inserted: 0 };
  try {
    matches = await matchIntent({
      id: row!.id,
      buyer_id: buyerId,
      intent_text: row!.intent_text,
      status: row!.status,
      structured: row!.structured,
    });
  } catch (e) { console.error(`[intents] ${action} match failed:`, e); }

  return NextResponse.json({ intent: row, matches });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ buyerId: string }> },
) {
  const { buyerId } = await params;
  const auth = await requireBuyerAuth(buyerId);
  if ('error' in auth) return auth.error;

  const url = new URL(req.url);
  const id = url.searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id query param required' }, { status: 400 });

  const { data, error } = await db
    .from('app_buyer_intents')
    .update({ status: 'cancelled', resolved_at: new Date().toISOString() })
    .eq('id', id)
    .eq('buyer_id', buyerId)
    .select('id')
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: 'intent not found' }, { status: 404 });
  return NextResponse.json({ success: true });
}
