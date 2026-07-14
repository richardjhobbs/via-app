/**
 * Agent-readable taste card. Published cards only: the curated public subset,
 * never voice_text, never the private profile, never rooms. This is the same
 * payload the get_taste_card MCP tools return.
 */
import { NextResponse } from 'next/server';
import { getPublishedCardBySlug, cardJson } from '@/lib/app/backroom/taste-cards';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const card = await getPublishedCardBySlug(slug);
  if (!card) return NextResponse.json({ error: 'no published card at this address' }, { status: 404 });
  return NextResponse.json(cardJson(card));
}
