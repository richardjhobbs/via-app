import type { NextConfig } from "next";

// The RRG app's pages are already routed under /rrg/ (app/rrg/*, app/rrg/download, etc.)
// No basePath needed — nginx proxies /rrg and /_next to this app as-is.
//
// output: standalone is only applied for production builds (VPS deployment).
// In dev mode it conflicts with Turbopack.
const nextConfig: NextConfig = {
  output: process.env.NODE_ENV === 'production' ? 'standalone' : undefined,
  turbopack: {},
  serverExternalPackages: ['agentmail', 'ethers'],
  async rewrites() {
    // Proxy brand onboarding at /brands/* to the standalone onboarding
    // app. The onboarding app is configured with basePath: '/brands' so
    // its routes, static assets, and API endpoints all serve under
    // /brands/*.
    const onboardingHost = 'https://via-brand-onboarding.vercel.app';
    return [
      { source: '/brands', destination: `${onboardingHost}/brands` },
      { source: '/brands/:path*', destination: `${onboardingHost}/brands/:path*` },
    ];
  },
};

export default nextConfig;
