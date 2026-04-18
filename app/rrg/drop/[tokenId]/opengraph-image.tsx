import { ImageResponse } from 'next/og';
import { getDropByTokenId } from '@/lib/rrg/db';
import { getSignedUrl } from '@/lib/rrg/storage';

export const runtime = 'nodejs';
export const revalidate = 3600; // re-generate every hour

export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default async function OGImage({
  params,
}: {
  params: Promise<{ tokenId: string }>;
}) {
  const { tokenId } = await params;
  const drop = await getDropByTokenId(Number(tokenId)).catch(() => null);

  // Fallback: plain branded card if drop not found
  if (!drop) {
    return new ImageResponse(
      <div
        style={{
          width: 1200, height: 630,
          background: '#0d0d0d',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontFamily: 'monospace',
        }}
      >
        <span style={{ color: '#ffffff', fontSize: 48, letterSpacing: '0.2em' }}>
          REAL REAL GENUINE
        </span>
      </div>,
      { width: 1200, height: 630 }
    );
  }

  // Fetch drop image
  let imageUrl: string | null = null;
  try {
    if (drop.jpeg_storage_path) {
      imageUrl = await getSignedUrl(drop.jpeg_storage_path, 3600);
    }
  } catch { /* non-fatal */ }

  const price = parseFloat(drop.price_usdc || '0').toFixed(2);

  return new ImageResponse(
    <div
      style={{
        width: 1200, height: 630,
        background: '#0d0d0d',
        display: 'flex',
        flexDirection: 'row',
      }}
    >
      {/* Left: drop image */}
      <div
        style={{
          width: 630, height: 630,
          background: '#1a1a1a',
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden',
        }}
      >
        {imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={imageUrl}
            alt={drop.title}
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
          />
        ) : (
          <span style={{ color: '#444', fontFamily: 'monospace', fontSize: 24 }}>
            #{tokenId}
          </span>
        )}
      </div>

      {/* Right: info panel */}
      <div
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          padding: '52px 56px',
          borderLeft: '1px solid rgba(255,255,255,0.1)',
        }}
      >
        {/* Top: RRG label */}
        <div
          style={{
            fontFamily: 'monospace',
            fontSize: 13,
            letterSpacing: '0.25em',
            color: 'rgba(255,255,255,0.45)',
            textTransform: 'uppercase',
            display: 'flex',
          }}
        >
          REAL REAL GENUINE
        </div>

        {/* Middle: title */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div
            style={{
              fontSize: drop.title.length > 30 ? 36 : 44,
              fontWeight: 300,
              color: '#ffffff',
              lineHeight: 1.15,
              letterSpacing: '-0.01em',
              fontFamily: 'sans-serif',
              display: 'flex',
            }}
          >
            {drop.title}
          </div>

          {drop.creator_bio && (
            <div
              style={{
                fontSize: 18,
                color: 'rgba(255,255,255,0.55)',
                lineHeight: 1.4,
                fontFamily: 'sans-serif',
                display: 'flex',
                maxHeight: 80,
                overflow: 'hidden',
              }}
            >
              {drop.creator_bio.slice(0, 120)}{drop.creator_bio.length > 120 ? '…' : ''}
            </div>
          )}
        </div>

        {/* Bottom: price + edition */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'baseline',
              gap: 16,
            }}
          >
            <span
              style={{
                fontSize: 32,
                fontFamily: 'monospace',
                color: '#ffffff',
                display: 'flex',
              }}
            >
              ${price}
            </span>
            <span
              style={{
                fontSize: 14,
                fontFamily: 'monospace',
                color: 'rgba(255,255,255,0.4)',
                display: 'flex',
              }}
            >
              USDC
            </span>
            <span
              style={{
                fontSize: 14,
                fontFamily: 'monospace',
                color: 'rgba(255,255,255,0.4)',
                marginLeft: 8,
                display: 'flex',
              }}
            >
              {drop.edition_size} ed.
            </span>
          </div>
          <div
            style={{
              fontSize: 13,
              fontFamily: 'monospace',
              color: 'rgba(255,255,255,0.3)',
              letterSpacing: '0.15em',
              display: 'flex',
            }}
          >
            realrealgenuine.com
          </div>
        </div>
      </div>
    </div>,
    { width: 1200, height: 630 }
  );
}
