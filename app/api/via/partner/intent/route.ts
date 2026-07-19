import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/app/db';
import { extractIntent } from '@/lib/app/buyer-matching';
import { teaserBrief } from '@/lib/app/demand';
import { broadcastTeaser } from '@/lib/app/broadcast';
import { isRateLimited } from '@/lib/app/rate-limit';

export const dynamic = 'force-dynamic';

/** A product the partner's search surfaced, shown on the Wire as a "Proposed"
 *  match. Public catalogue data only; validated + clipped before it is stored. */
export interface StoredProposal {
  product_id: string | null;
  title: string;
  seller_name: string | null;
  price_usdc: number | null;
  url: string | null;
}

function cleanProposals(v: unknown): StoredProposal[] {
  if (!Array.isArray(v)) return [];
  const out: StoredProposal[] = [];
  for (const p of v.slice(0, 6)) {
    if (!p || typeof p !== 'object') continue;
    const r = p as Record<string, unknown>;
    const title = typeof r.title === 'string' ? r.title.trim().slice(0, 140) : '';
    if (!title) continue;
    const price = typeof r.price_usdc === 'number' && Number.isFinite(r.price_usdc) ? r.price_usdc : null;
    const url = typeof r.url === 'string' && /^https?:\/\//i.test(r.url) ? r.url.slice(0, 300) : null;
    out.push({
      product_id: r.product_id != null ? String(r.product_id).slice(0, 64) : null,
      title,
      seller_name: typeof r.seller_name === 'string' ? r.seller_name.trim().slice(0, 80) : null,
      price_usdc: price,
      url,
    });
  }
  return out;
}

/**
 * POST /api/via/partner/intent
 *
 * Inbound demand from a TRUSTED partner platform's agents (currently RRG's
 * personal agents). When an RRG agent runs a product search that returns VIA
 * results, RRG posts the shopper's raw query here so it lands on the demand
 * feed as live demand, exactly like a first-party brief. The mirror of the
 * NOSTR inbound path, with a partner secret instead of a relay listener:
 *   - shared-secret gated (VIA_PARTNER_INGEST_SECRET) so only the partner can call,
 *   - deduped on the partner's stable dedupe_key (re-sends never duplicate a brief),
 *   - all partner-origin briefs are owned by ONE dedicated buyer
 *     (RRG_INBOUND_BUYER_ID) so untrusted input can never spawn buyer rows,
 *   - rate-limited per source agent id,
 *   - then created + broadcast exactly like a first-party brief (extractIntent ->
 *     insert -> teaser -> broadcastTeaser), so it fans out to every channel.
 *
 * intent_text never leaves the system; only the teaser + door go on any channel.
 */
export async function POST(req: NextRequest) {
  const secret = process.env.VIA_PARTNER_INGEST_SECRET;
  const inboundBuyerId = process.env.RRG_INBOUND_BUYER_ID;
  if (!secret || !inboundBuyerId) {
    return NextResponse.json({ error: 'partner ingest not configured' }, { status: 503 });
  }
  if (req.headers.get('x-partner-ingest-secret') !== secret) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  let body: { partner?: unknown; agent_id?: unknown; dedupe_key?: unknown; intent_text?: unknown };
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'invalid JSON' }, { status: 400 }); }

  const partner = typeof body.partner === 'string' ? body.partner.trim() : '';
  const agentId = typeof body.agent_id === 'string' ? body.agent_id.trim() : '';
  const dedupeKey = typeof body.dedupe_key === 'string' ? body.dedupe_key.trim() : '';
  const intentText = typeof body.intent_text === 'string' ? body.intent_text.trim() : '';
  const proposals = cleanProposals((body as { proposals?: unknown }).proposals);
  if (partner !== 'rrg' || !agentId || !dedupeKey || intentText.length < 2) {
    return NextResponse.json({ error: 'partner:"rrg", agent_id, dedupe_key and intent_text (>=2 chars) required' }, { status: 400 });
  }
  if (intentText.length > 2000) {
    return NextResponse.json({ error: 'intent_text too long' }, { status: 400 });
  }

  // Per-agent rate limit: bound LLM spend + demand-feed abuse from any one agent.
  if (isRateLimited(`partner-intent|${agentId}`, 10, 60_000)) {
    return NextResponse.json({ error: 'rate limited' }, { status: 429 });
  }

  // Idempotent on the partner's dedupe_key: a repeated identical search must not
  // create a second brief. The key is stored in structured.partner.dedupe_key.
  const { data: existing } = await db
    .from('app_buyer_intents')
    .select('id, structured')
    .eq('buyer_id', inboundBuyerId)
    .eq('structured->partner->>dedupe_key', dedupeKey)
    .maybeSingle();
  if (existing) {
    // Repeat search: refresh the surfaced proposals and resurface the demand
    // (a re-search can return newer/different matches). Best-effort.
    if (proposals.length) {
      const prev = (existing.structured ?? {}) as Record<string, unknown>;
      const merged = { ...prev, proposals };
      const { data: bumped } = await db
        .from('app_buyer_intents')
        .update({ structured: merged, broadcast_at: new Date().toISOString() })
        .eq('id', existing.id)
        .select('id, structured')
        .single();
      if (bumped) {
        const teaser = teaserBrief({ id: bumped.id as string, structured: bumped.structured as Record<string, unknown> | null });
        if (teaser) await broadcastTeaser(teaser);
      }
    }
    return NextResponse.json({ intent_id: existing.id, door_url: `/api/via/brief/${existing.id}`, deduped: true });
  }

  const meter = { tokens: 0 };
  let search_intent;
  try { search_intent = await extractIntent(intentText, meter); }
  catch (e) { console.error('[partner-intent] extractIntent failed:', e); return NextResponse.json({ error: 'intent extraction failed' }, { status: 502 }); }

  const structured = {
    search_intent,
    search_terms: search_intent.terms,
    partner: { source: 'rrg-agent', agent_id: agentId, dedupe_key: dedupeKey },
    source: 'rrg-agent',
    ...(proposals.length ? { proposals } : {}),
  };

  const { data, error } = await db
    .from('app_buyer_intents')
    .insert({ buyer_id: inboundBuyerId, intent_text: intentText, structured, status: 'broadcast', broadcast_at: new Date().toISOString(), discoverable: true })
    .select('id, structured')
    .single();
  if (error || !data) {
    console.error('[partner-intent] insert failed:', error);
    return NextResponse.json({ error: 'failed to create brief' }, { status: 500 });
  }

  const teaser = teaserBrief({ id: data.id as string, structured: data.structured as Record<string, unknown> | null });
  if (teaser) await broadcastTeaser(teaser);

  return NextResponse.json({ intent_id: data.id, door_url: teaser?.door_url ?? `/api/via/brief/${data.id}`, broadcast: !!teaser }, { status: 201 });
}
