import type { MetadataRoute } from 'next';
import { db } from '@/lib/app/db';

export const revalidate = 3600;

const BASE = 'https://realrealgenuine.com';

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date();

  const staticRoutes: MetadataRoute.Sitemap = [
    { url: `${BASE}/`, lastModified: now, changeFrequency: 'daily', priority: 1.0 },
    { url: `${BASE}/rrg`, lastModified: now, changeFrequency: 'daily', priority: 0.9 },
    { url: `${BASE}/rrg/all`, lastModified: now, changeFrequency: 'daily', priority: 0.8 },
    { url: `${BASE}/rrg/faq`, lastModified: now, changeFrequency: 'monthly', priority: 0.5 },
    { url: `${BASE}/rrg/submit`, lastModified: now, changeFrequency: 'monthly', priority: 0.5 },
    { url: `${BASE}/shop`, lastModified: now, changeFrequency: 'daily', priority: 0.7 },
    { url: `${BASE}/terms`, lastModified: now, changeFrequency: 'yearly', priority: 0.2 },
    { url: `${BASE}/privacy`, lastModified: now, changeFrequency: 'yearly', priority: 0.2 },
  ];

  const { data: brands } = await db
    .from('app_sellers')
    .select('slug, updated_at')
    .eq('status', 'active');

  const brandRoutes: MetadataRoute.Sitemap = (brands ?? []).map((b) => ({
    url: `${BASE}/brand/${b.slug}`,
    lastModified: b.updated_at ? new Date(b.updated_at) : now,
    changeFrequency: 'daily',
    priority: 0.8,
  }));

  const { data: listings } = await db
    .from('rrg_submissions')
    .select('token_id, approved_at')
    .eq('status', 'approved')
    .not('token_id', 'is', null)
    .order('approved_at', { ascending: false })
    .limit(1000);

  const listingRoutes: MetadataRoute.Sitemap = (listings ?? []).map((l) => ({
    url: `${BASE}/rrg/drop/${l.token_id}`,
    lastModified: l.approved_at ? new Date(l.approved_at) : now,
    changeFrequency: 'weekly',
    priority: 0.6,
  }));

  return [...staticRoutes, ...brandRoutes, ...listingRoutes];
}
