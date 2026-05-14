import { NextResponse } from 'next/server';
import { getAllBrands } from '@/lib/rrg/db';
import { isAdminReader, adminUnauthorized } from '@/lib/rrg/auth';
import { getSignedUrl } from '@/lib/rrg/storage';

export const dynamic = 'force-dynamic';

// GET /api/rrg/admin/brands — list all brands with signed image URLs.
// Full admin (cookie / x-admin-secret) or read-only (x-admin-readonly-secret).
export async function GET(req: Request) {
  if (!(await isAdminReader(req))) return adminUnauthorized();

  try {
    const brands = await getAllBrands();

    // Attach signed URLs for logo and banner
    const withUrls = await Promise.all(
      brands.map(async (b) => {
        let logoUrl: string | null = null;
        let bannerUrl: string | null = null;
        try {
          if (b.logo_path) logoUrl = await getSignedUrl(b.logo_path, 3600);
        } catch { /* non-fatal */ }
        try {
          if (b.banner_path) bannerUrl = await getSignedUrl(b.banner_path, 3600);
        } catch { /* non-fatal */ }
        return { ...b, logoUrl, bannerUrl };
      })
    );

    return NextResponse.json({ brands: withUrls });
  } catch (err) {
    console.error('[/api/rrg/admin/brands]', err);
    return NextResponse.json({ error: 'Failed to fetch brands' }, { status: 500 });
  }
}
