/**
 * Buyer memory bridge for the linked RRG chat shell , SECRET-GATED.
 *
 * VIA is the system of record for a migrated buyer agent's memory. RRG's
 * concierge chat, for a via_buyer_linked agent, reads that memory from here (so
 * the agent turns up "as usual" with its learned context) and writes new
 * learnings back here (so VIA stays the single source). Resolves the buyer by
 * linked_rrg_agent_id.
 *
 *   GET  ?rrg_agent_id=&limit=   -> { memories: [{ id, type, content, active, created_at }] }
 *   POST { rrg_agent_id, type?, content, source? } -> persists one memory
 */
import { NextResponse } from 'next/server';
import { db } from '@/lib/app/db';
import { platformSecretOk } from '@/lib/app/platform-secret';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// VIA buyer-memory type -> the shape RRG's concierge prompt groups on.
function toRrgType(t: string): string {
  switch (t) {
    case 'brand_affinity': return 'brand';
    case 'constraint':     return 'size';
    case 'preference':     return 'preference';
    case 'consolidated':   return 'consolidated';
    default:               return 'general';
  }
}
// RRG type -> a VIA buyer-memory type for writes.
function fromRrgType(t: string | undefined): string {
  switch (t) {
    case 'brand':        return 'brand_affinity';
    case 'size':         return 'constraint';
    case 'style':
    case 'preference':   return 'preference';
    case 'consolidated': return 'preference';
    default:             return 'general';
  }
}

async function resolveBuyerId(rrgAgentId: string): Promise<string | null> {
  const { data } = await db.from('app_buyers').select('id').eq('linked_rrg_agent_id', rrgAgentId).maybeSingle();
  return (data as { id: string } | null)?.id ?? null;
}

export async function GET(req: Request) {
  if (!platformSecretOk(req)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const url = new URL(req.url);
  const rrgAgentId = url.searchParams.get('rrg_agent_id')?.trim() ?? '';
  const limit = Math.min(Math.max(Number(url.searchParams.get('limit') ?? 30) || 30, 1), 100);
  if (!rrgAgentId) return NextResponse.json({ error: 'rrg_agent_id required' }, { status: 400 });

  const buyerId = await resolveBuyerId(rrgAgentId);
  if (!buyerId) return NextResponse.json({ error: 'not_migrated' }, { status: 404 });

  const { data } = await db
    .from('app_buyer_memories')
    .select('id, type, title, body, active, created_at')
    .eq('buyer_id', buyerId)
    .eq('active', true)
    .order('created_at', { ascending: false })
    .limit(limit);

  const memories = ((data ?? []) as Array<{ id: string; type: string; title: string | null; body: string; active: boolean; created_at: string }>)
    .map((m) => ({
      id: m.id,
      type: toRrgType(m.type),
      content: m.body || m.title || '',
      active: m.active,
      created_at: m.created_at,
      // These memories were set/learned outside the current RRG session; marking
      // them seed-like keeps RRG's prompt grouping sensible.
      source_session_id: null as string | null,
      superseded_by: null as string | null,
    }));

  return NextResponse.json({ memories }, { headers: { 'cache-control': 'no-store' } });
}

export async function POST(req: Request) {
  if (!platformSecretOk(req)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  let body: { rrg_agent_id?: string; type?: string; content?: string; source?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'invalid JSON' }, { status: 400 }); }

  const rrgAgentId = body.rrg_agent_id?.trim() ?? '';
  const content = (body.content ?? '').trim();
  if (!rrgAgentId) return NextResponse.json({ error: 'rrg_agent_id required' }, { status: 400 });
  if (content.length < 3) return NextResponse.json({ error: 'content required' }, { status: 400 });

  const buyerId = await resolveBuyerId(rrgAgentId);
  if (!buyerId) return NextResponse.json({ error: 'not_migrated' }, { status: 404 });

  const oneLine = content.replace(/\s+/g, ' ').trim();
  const title = oneLine.length <= 80 ? oneLine : `${oneLine.slice(0, 77)}...`;
  const { error } = await db.from('app_buyer_memories').insert({
    buyer_id:        buyerId,
    type:            fromRrgType(body.type),
    title,
    body:            content.slice(0, 2000),
    structured:      {},
    tags:            ['rrg-chat'],
    active:          true,
    external_source: 'rrg',
    external_id:     `chat:${Date.now()}`,
  });
  if (error) {
    console.error('[buyer/memories] write failed:', error);
    return NextResponse.json({ error: 'write_failed' }, { status: 500 });
  }
  return NextResponse.json({ ok: true }, { headers: { 'cache-control': 'no-store' } });
}
