import { getPublishedCardBySlug } from '@/lib/app/backroom/taste-cards';
import { renderCardImage, CARD_IMAGE_SIZES } from '@/lib/app/backroom/taste-card-image';
import { ImageResponse } from 'next/og';

export const runtime = 'nodejs';
export const size = CARD_IMAGE_SIZES.og;
export const contentType = 'image/png';
export const alt = 'Taste card on VIA';

export default async function OpengraphImage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const card = await getPublishedCardBySlug(slug);
  if (!card) {
    return new ImageResponse(
      (
        <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: '#f4efe6', color: '#7c7060', fontSize: 40 }}>
          VIA
        </div>
      ),
      size,
    );
  }
  return renderCardImage(card, 'og');
}
