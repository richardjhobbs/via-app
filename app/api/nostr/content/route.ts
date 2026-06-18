import { NextRequest, NextResponse } from 'next/server';
import type { EventTemplate } from 'nostr-tools/pure';
import { publishContentAs, isContentIdentity } from '@/lib/app/broadcast/nostr';

export const dynamic = 'force-dynamic';

/**
 * POST /api/nostr/content
 *
 * Publish APPROVED standalone content under a VIA content identity:
 *   - priscilla : human-facing depth (plain explanations of agentic commerce).
 *   - rosie     : agent-facing depth (the intent spec, how to subscribe/respond).
 *
 * This is the publish mechanism for the draft-then-approve flow: the agent (or a
 * human) sends already-approved content here; this route signs it with the named
 * identity's key and publishes to NOSTR_RELAYS (relay.getvia.xyz first, so the VPS
 * broadcaster fans it out to the wider network). The via platform identity is NOT
 * postable here , it only ever emits automated demand/offer events.
 *
 * Shared-secret gated (CONTENT_API_TOKEN header x-via-token), same posture as the
 * NOSTR intent-ingest route. Reachable over HTTPS so the posting agent can run
 * anywhere; no key ever leaves the server.
 *
 * Body: { identity, kind?, content, title?, summary?, slug?, tags?, reply_to? }
 *   kind      : 1 (note, default) or 30023 (NIP-23 long-form article).
 *   reply_to  : { event_id, pubkey?, relay? } to thread a public reply.
 *   long-form : title/summary/slug populate the NIP-23 addressable tags.
 */
const KIND_NOTE = 1;
const KIND_LONGFORM = 30023;

export async function POST(req: NextRequest) {
  const token = process.env.CONTENT_API_TOKEN;
  if (!token) return NextResponse.json({ error: 'content endpoint not configured' }, { status: 503 });
  if (req.headers.get('x-via-token') !== token) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  let body: {
    identity?: unknown; kind?: unknown; content?: unknown;
    title?: unknown; summary?: unknown; slug?: unknown;
    tags?: unknown; reply_to?: { event_id?: unknown; pubkey?: unknown; relay?: unknown };
  };
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'invalid JSON' }, { status: 400 }); }

  const identity = typeof body.identity === 'string' ? body.identity.trim() : '';
  if (!isContentIdentity(identity)) {
    return NextResponse.json({ error: 'identity must be priscilla or rosie' }, { status: 400 });
  }

  const kind = Number(body.kind ?? KIND_NOTE);
  if (![KIND_NOTE, KIND_LONGFORM].includes(kind)) {
    return NextResponse.json({ error: 'kind must be 1 or 30023' }, { status: 400 });
  }

  const content = typeof body.content === 'string' ? body.content : '';
  if (!content.trim()) return NextResponse.json({ error: 'content required' }, { status: 400 });

  // Caller-supplied tags, validated to string arrays only.
  const tags: string[][] = Array.isArray(body.tags)
    ? body.tags.filter((t): t is string[] => Array.isArray(t) && t.every((x) => typeof x === 'string'))
    : [];

  // Public reply threading (NIP-10).
  const rt = body.reply_to;
  if (rt && typeof rt.event_id === 'string') {
    tags.push(['e', rt.event_id, typeof rt.relay === 'string' ? rt.relay : '', 'reply']);
    if (typeof rt.pubkey === 'string') tags.push(['p', rt.pubkey]);
  }

  // NIP-23 long-form needs a `d` tag; title/summary recommended.
  if (kind === KIND_LONGFORM) {
    const slug = typeof body.slug === 'string' && body.slug.trim() ? body.slug.trim() : `via-${Date.now()}`;
    tags.push(['d', slug]);
    if (typeof body.title === 'string' && body.title.trim()) tags.push(['title', body.title.trim()]);
    if (typeof body.summary === 'string' && body.summary.trim()) tags.push(['summary', body.summary.trim()]);
    tags.push(['published_at', String(Math.floor(Date.now() / 1000))]);
  }

  tags.push(['t', 'via']);

  const tmpl: EventTemplate = {
    kind,
    created_at: Math.floor(Date.now() / 1000),
    tags,
    content,
  };

  const result = await publishContentAs(identity, tmpl);
  if (!result.ok) {
    return NextResponse.json({ error: 'publish failed (identity key or relays unset, or no relay accepted)' }, { status: 502 });
  }
  return NextResponse.json({ ok: true, identity, npub: result.npub, event_id: result.eventId, relays: result.relays }, { status: 201 });
}
