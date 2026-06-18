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
import { extractIntent } from '@/lib/app/buyer-matching';
import { teaserBrief } from '@/lib/app/demand';
import { broadcastTeaser } from '@/lib/app/broadcast';
import { hasCredits, deductCredits } from '@/lib/app/buyer-credits';

const INSUFFICIENT = {
  error: 'Out of credits. Top up, or connect your own LLM key, to keep sourcing briefs.',
  code: 'insufficient_credits',
} as const;

export const dynamic = 'force-dynamic';

/** Clamp an option-count input (how many offers the buyer wants to see) to 1..20. */
function clampOptionCount(v: unknown): number | null {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.min(Math.max(Math.trunc(n), 1), 20);
}

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

  let body: { intent_text?: unknown; structured?: unknown; preview?: unknown; option_count?: unknown };
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 }); }

  const intentText = String(body.intent_text ?? '').trim();
  if (intentText.length < 3 || intentText.length > 2000) {
    return NextResponse.json({ error: 'intent_text must be 3 to 2000 characters' }, { status: 400 });
  }

  // PREVIEW mode: distil the brief into a structured intent and return it for the
  // owner to review/edit BEFORE anything is persisted or broadcast. No DB write.
  // The confirm step (no preview flag) posts the edited intent back as
  // structured.search_intent, which the teaser/door/proxy all read verbatim.
  // Extraction spends platform DeepSeek, so gate it on credits.
  if (body.preview === true) {
    if (!(await hasCredits(buyerId))) {
      return NextResponse.json(INSUFFICIENT, { status: 402 });
    }
    const meter = { tokens: 0 };
    const search_intent = await extractIntent(intentText, meter);
    if (meter.tokens > 0) {
      try { await deductCredits(buyerId, meter.tokens, 'brief preview'); } catch (e) { console.error('[intents] preview meter failed:', e); }
    }
    return NextResponse.json({ preview: true, intent_text: intentText, search_intent });
  }

  let structured = body.structured && typeof body.structured === 'object' && !Array.isArray(body.structured)
    ? (body.structured as Record<string, unknown>)
    : {};

  // Ensure a structured intent exists before broadcasting , the teaser, the door,
  // and the proxy reaction all read structured.search_intent. Normally the preview
  // step already produced it; extract defensively (metered) if a client confirmed
  // without one.
  if (!structured.search_intent) {
    if (!(await hasCredits(buyerId))) {
      return NextResponse.json(INSUFFICIENT, { status: 402 });
    }
    const meter = { tokens: 0 };
    const search_intent = await extractIntent(intentText, meter);
    if (meter.tokens > 0) {
      try { await deductCredits(buyerId, meter.tokens, 'brief broadcast'); } catch (e) { console.error('[intents] broadcast meter failed:', e); }
    }
    structured = { ...structured, search_intent, search_terms: search_intent.terms };
  }

  // How many offers the buyer wants to see (caps the dashboard offer list).
  const optionCount = clampOptionCount(body.option_count);
  if (optionCount !== null) structured = { ...structured, option_count: optionCount };

  // BROADCAST the brief. The matching is now the seller side's job: the teaser
  // goes out on every channel (feed, door, future adapters), the proxy reaction
  // cron and external seller agents respond with offers. No synchronous index
  // search , that was the "shitty search engine" path.
  const { data, error } = await db
    .from('app_buyer_intents')
    .insert({ buyer_id: buyerId, intent_text: intentText, structured, status: 'broadcast', broadcast_at: new Date().toISOString() })
    .select('id, intent_text, structured, status, broadcast_at, resolved_at, created_at')
    .single();

  if (error || !data) return NextResponse.json({ error: error?.message ?? 'insert failed' }, { status: 500 });

  // Publish the teaser to the broadcast channels (NOSTR relay + the pull feed).
  const teaser = teaserBrief({ id: data.id as string, structured: data.structured as Record<string, unknown> | null });
  if (teaser) await broadcastTeaser(teaser);

  return NextResponse.json({ intent: data, broadcast: true }, { status: 201 });
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

  // reinstate / rematch both RE-BROADCAST the brief , no synchronous search, so no
  // DeepSeek spend and no credit gate. The proxy reaction cron and external seller
  // agents pick the brief up again; new sellers / new stock produce new offers.
  const COLS = 'id, intent_text, structured, status, broadcast_at, resolved_at, created_at';
  const nowIso = new Date().toISOString();

  if (action === 'reinstate') {
    // Reinstate a cancelled brief back to broadcast (24h grace window before cleanup).
    const upd = await db
      .from('app_buyer_intents')
      .update({ status: 'broadcast', resolved_at: null, broadcast_at: nowIso })
      .eq('id', id).eq('buyer_id', buyerId).eq('status', 'cancelled')
      .select(COLS)
      .maybeSingle();
    if (upd.error) return NextResponse.json({ error: upd.error.message }, { status: 500 });
    if (!upd.data) return NextResponse.json({ error: 'brief not found or not cancelled' }, { status: 404 });
    const teaser = teaserBrief({ id: upd.data.id as string, structured: upd.data.structured as Record<string, unknown> | null });
    if (teaser) await broadcastTeaser(teaser);
    return NextResponse.json({ intent: upd.data, broadcast: true });
  }

  // Rematch an active brief: re-broadcast it (bump broadcast_at) so sellers
  // reconsider it on the next pass.
  const upd = await db
    .from('app_buyer_intents')
    .update({ status: 'broadcast', broadcast_at: nowIso })
    .eq('id', id).eq('buyer_id', buyerId).in('status', ['open', 'broadcast', 'matched'])
    .select(COLS)
    .maybeSingle();
  if (upd.error) return NextResponse.json({ error: upd.error.message }, { status: 500 });
  if (!upd.data) return NextResponse.json({ error: 'brief not found or not active' }, { status: 404 });
  const teaser = teaserBrief({ id: upd.data.id as string, structured: upd.data.structured as Record<string, unknown> | null });
  if (teaser) await broadcastTeaser(teaser);
  return NextResponse.json({ intent: upd.data, broadcast: true });
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
