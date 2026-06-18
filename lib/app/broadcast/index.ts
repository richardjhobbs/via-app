/**
 * lib/app/broadcast/index.ts
 *
 * The broadcast dispatcher. When a buyer broadcasts (or re-broadcasts) an intent,
 * the platform fans the TEASER out to every push channel. Adding a channel is
 * adding an adapter here , nothing else changes.
 *
 * Channels:
 *   - Public demand feed (GET /api/via/demand) , PULL based, always live, no push
 *     needed; any agent can poll it.
 *   - NOSTR relay , PUSH; publishes the teaser to the open relay network so seller
 *     agents outside VIA can see the demand and respond at the door.
 *
 * The platform's only job here is to publish the teaser. It never evaluates
 * sellers , a seller sees the teaser, self-selects, and responds on its own side.
 * Best-effort and non-fatal: a broadcast failure never blocks intent creation.
 */
import type { TeaserBrief } from '../demand';
import { publishTeaserToNostr } from './nostr';

export async function broadcastTeaser(teaser: TeaserBrief): Promise<void> {
  try {
    const r = await publishTeaserToNostr(teaser);
    if (r.ok) console.log(`[broadcast] teaser ${teaser.brief_id} published to ${r.relays} relay(s)`);
  } catch (e) {
    console.warn('[broadcast] teaser dispatch failed:', e);
  }
}
