/**
 * Downloadable taste card images: story (1080x1920) and square (1080x1080).
 * The 1200x630 link preview is the route-level opengraph-image. Published
 * cards only.
 */
import { NextResponse } from 'next/server';
import { getPublishedCardBySlug } from '@/lib/app/backroom/taste-cards';
import { renderCardImage, type CardImageFormat } from '@/lib/app/backroom/taste-card-image';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const card = await getPublishedCardBySlug(slug);
  if (!card) return NextResponse.json({ error: 'no published card at this address' }, { status: 404 });

  const raw = new URL(req.url).searchParams.get('format') ?? 'story';
  const format: CardImageFormat = raw === 'square' ? 'square' : raw === 'og' ? 'og' : 'story';

  const image = await renderCardImage(card, format);
  const headers = new Headers(image.headers);
  headers.set('Content-Disposition', `attachment; filename="taste-${card.slug}-${format}.png"`);
  return new NextResponse(image.body, { status: 200, headers });
}
