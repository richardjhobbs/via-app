/**
 * lib/app/network-intent.ts
 *
 * Broadcast an ANONYMOUS network-connector intent onto the demand rail + The Wire.
 *
 * The central MCP's submit_intent is called by agents that have no VIA buyer
 * account, so every such intent is filed under ONE dedicated public buyer
 * ("via-network-demand"), exactly like the RRG partner and NOSTR inbound channels
 * (app/api/via/partner/intent, app/api/via/nostr/intent). Only the anonymised
 * teaser (category / product type / one attribute) ever surfaces; the raw
 * intent_text and any identity never leave.
 *
 * Deduped on the normalised text within the active set, so a repeated identical
 * search RESURFACES (bumps broadcast_at) instead of spamming a second teaser onto
 * The Wire. If the dedicated buyer is not provisioned, this is a silent no-op, so
 * discovery never breaks on the broadcast side-effect.
 */
import { db } from './db';
import { teaserBrief, type TeaserBrief } from './demand';
import { broadcastTeaser } from './broadcast';
import type { BriefIntent } from './buyer-matching';

const NETWORK_BUYER_HANDLE = 'via-network-demand';
const ACTIVE = ['open', 'broadcast', 'matched'];

// Resolve the dedicated public buyer once per warm instance (undefined = not yet
// resolved, null = not provisioned).
let cachedBuyerId: string | null | undefined;

async function networkBuyerId(): Promise<string | null> {
  if (cachedBuyerId !== undefined) return cachedBuyerId;
  const { data } = await db
    .from('app_buyers')
    .select('id')
    .eq('handle', NETWORK_BUYER_HANDLE)
    .eq('public', true)
    .maybeSingle();
  cachedBuyerId = (data?.id as string | undefined) ?? null;
  return cachedBuyerId;
}

function dedupeKey(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 300);
}

/**
 * Persist + broadcast an anonymous network intent. Returns the teaser that went
 * onto the demand feed / The Wire, or null when nothing broadcastable was
 * produced (no dedicated buyer, or the intent had no category/type to tease).
 * Never throws: broadcasting is a side-effect of discovery, never its gate.
 */
export async function broadcastNetworkIntent(intentText: string, brief: BriefIntent): Promise<TeaserBrief | null> {
  try {
    const buyerId = await networkBuyerId();
    if (!buyerId) return null;

    const key = dedupeKey(intentText);
    const structured = {
      search_intent: brief,
      search_terms:  brief.terms,
      source:        'network-agent',
      network:       { dedupe_key: key },
    };
    const nowIso = new Date().toISOString();

    // Dedup: an identical active network intent resurfaces rather than duplicating.
    const { data: existing } = await db
      .from('app_buyer_intents')
      .select('id')
      .eq('buyer_id', buyerId)
      .eq('structured->network->>dedupe_key', key)
      .in('status', ACTIVE)
      .maybeSingle();

    let row: { id: string; structured: Record<string, unknown> | null } | null;
    if (existing) {
      const { data } = await db
        .from('app_buyer_intents')
        .update({ structured, status: 'broadcast', broadcast_at: nowIso, discoverable: true })
        .eq('id', existing.id)
        .select('id, structured')
        .single();
      row = data as { id: string; structured: Record<string, unknown> | null } | null;
    } else {
      const { data, error } = await db
        .from('app_buyer_intents')
        .insert({ buyer_id: buyerId, intent_text: intentText, structured, status: 'broadcast', broadcast_at: nowIso, discoverable: true })
        .select('id, structured')
        .single();
      if (error) { console.warn('[network-intent] insert failed:', error.message); return null; }
      row = data as { id: string; structured: Record<string, unknown> | null } | null;
    }
    if (!row) return null;

    const teaser = teaserBrief({ id: row.id, structured: row.structured });
    if (teaser) await broadcastTeaser(teaser);
    return teaser;
  } catch (e) {
    console.warn('[network-intent] broadcast failed (non-fatal):', e);
    return null;
  }
}
