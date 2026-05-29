import type { MetadataRoute } from 'next';

export const revalidate = 3600;

const BASE = 'https://app.getvia.xyz';

/**
 * Sitemap for app.getvia.xyz.
 *
 * Seller dashboards live behind auth and are not indexed. The public
 * per-seller cards live on the marketing domain (getvia.xyz/sellers/[slug])
 * and are sitemapped there, not here. This sitemap therefore lists just
 * the public onboarding entry points.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date();
  return [
    { url: `${BASE}/`,                       lastModified: now, changeFrequency: 'monthly', priority: 0.6 },
    { url: `${BASE}/onboard?role=seller`,    lastModified: now, changeFrequency: 'monthly', priority: 0.8 },
    { url: `${BASE}/onboard?role=buyer`,     lastModified: now, changeFrequency: 'monthly', priority: 0.7 },
    { url: `${BASE}/seller/login`,           lastModified: now, changeFrequency: 'monthly', priority: 0.4 },
    { url: `${BASE}/buyer/login`,            lastModified: now, changeFrequency: 'monthly', priority: 0.3 },
  ];
}
