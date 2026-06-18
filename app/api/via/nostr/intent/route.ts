import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/app/db';
import { extractIntent } from '@/lib/app/buyer-matching';
import { teaserBrief } from '@/lib/app/demand';
import { broadcastTeaser } from '@/lib/app/broadcast';
import { isRateLimited } from '@/lib/app/rate-limit';
import type { InboundIntentRequest } from '@/lib/app/broadcast/nostr-protocol';

export const dynamic = 'force-dynamic';

/**
 * POST /api/via/nostr/intent
 *
 * Inbound demand from an EXTERNAL agent over NOSTR (a VIA Intent Request event),
 * relayed here by the trusted NOSTR listener (scripts/nostr-intent-listener.mjs).
 * This is the "open intent over NOSTR" path: an agent with no VIA account can
 * create demand on the network. The listener does the relay subscription + the
 * per-pubkey policing; this endpoint does the durable ingest:
 *   - shared-secret gated (NOSTR_INGEST_SECRET) so only the listener can call it,
 *   - deduped on the NOSTR event id (re-delivery never duplicates a brief),
 *   - all NOSTR-origin briefs are owned by ONE dedicated buyer
 *     (NOSTR_INBOUND_BUYER_ID) so untrusted input can never spawn buyer rows,
 *   - rate-limited per source pubkey,
 *   - then created + broadcast exactly like a first-party brief (extractIntent ->
 *     insert -> teaser -> broadcastTeaser), so it fans out to every channel.
 *
 * intent_text never leaves the system; only the teaser + door go on any relay.
 */
export async function POST(req: NextRequest) {
  const secret = process.env.NOSTR_INGEST_SECRET;
  const inboundBuyerId = process.env.NOSTR_INBOUND_BUYER_ID;
  if (!secret || !inboundBuyerId) {
    return NextResponse.json({ error: 'nostr ingest not configured' }, { status: 503 });
  }
  if (req.headers.get('x-nostr-ingest-secret') !== secret) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  let body: { event_id?: unknown; pubkey?: unknown; intent?: unknown };
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'invalid JSON' }, { status: 400 }); }

  const eventId = typeof body.event_id === 'string' ? body.event_id.trim() : '';
  const pubkey = typeof body.pubkey === 'string' ? body.pubkey.trim().toLowerCase() : '';
  const intent = (body.intent && typeof body.intent === 'object') ? body.intent as InboundIntentRequest : null;
  if (!/^[0-9a-f]{64}$/.test(eventId) || !/^[0-9a-f]{64}$/.test(pubkey) || !intent) {
    return NextResponse.json({ error: 'event_id, pubkey (64-hex) and intent required' }, { status: 400 });
  }

  // Per-pubkey rate limit: bound LLM spend + demand-feed abuse from any one agent.
  if (isRateLimited(`nostr-intent|${pubkey}`, 10, 60_000)) {
    return NextResponse.json({ error: 'rate limited' }, { status: 429 });
  }

  // Idempotent on the NOSTR event id: a relay re-delivering the same event must
  // not create a second brief. The event id is stored in structured.nostr.
  const { data: existing } = await db
    .from('app_buyer_intents')
    .select('id')
    .eq('buyer_id', inboundBuyerId)
    .eq('structured->nostr->>event_id', eventId)
    .maybeSingle();
  if (existing) {
    return NextResponse.json({ intent_id: existing.id, door_url: `/api/via/brief/${existing.id}`, deduped: true });
  }

  // Synthesise the intent text from whatever the agent supplied.
  const intentText = (intent.intent_text && intent.intent_text.trim())
    || [intent.category, ...(intent.requirements ?? []), ...(intent.preferences ?? [])].filter(Boolean).join(', ').trim();
  if (!intentText) return NextResponse.json({ error: 'intent has no usable content' }, { status: 400 });

  const meter = { tokens: 0 };
  let search_intent;
  try { search_intent = await extractIntent(intentText, meter); }
  catch (e) { console.error('[nostr-intent] extractIntent failed:', e); return NextResponse.json({ error: 'intent extraction failed' }, { status: 502 }); }

  const structured = {
    search_intent,
    search_terms: search_intent.terms,
    nostr: { event_id: eventId, pubkey, client: intent.client ?? null },
    source: 'nostr',
  };

  const { data, error } = await db
    .from('app_buyer_intents')
    .insert({ buyer_id: inboundBuyerId, intent_text: intentText, structured, status: 'broadcast', broadcast_at: new Date().toISOString(), discoverable: true })
    .select('id, structured')
    .single();
  if (error || !data) {
    console.error('[nostr-intent] insert failed:', error);
    return NextResponse.json({ error: 'failed to create brief' }, { status: 500 });
  }

  const teaser = teaserBrief({ id: data.id as string, structured: data.structured as Record<string, unknown> | null });
  if (teaser) await broadcastTeaser(teaser);

  return NextResponse.json({ intent_id: data.id, door_url: teaser?.door_url ?? `/api/via/brief/${data.id}`, broadcast: !!teaser }, { status: 201 });
}
