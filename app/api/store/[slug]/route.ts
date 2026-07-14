/**
 * Agent-readable marketing card for a room-graduated store: the co-created
 * product, its price, the co-creators with verifiable identity, and the buy
 * pointer. Never exposes the paid deliverable key.
 */
import { NextResponse } from 'next/server';
import { getStoreCardBySlug, storeCardJson } from '@/lib/app/backroom/store-card';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const card = await getStoreCardBySlug(slug);
  if (!card) return NextResponse.json({ error: 'no store card at this address' }, { status: 404 });
  return NextResponse.json(storeCardJson(card));
}
