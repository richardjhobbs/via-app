import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // No `output: 'standalone'` — Vercel deploys serverless functions directly
  // and `standalone` bundles middleware with Node-specific globals
  // (__dirname, require) that the Edge runtime rejects, which is what
  // caused MIDDLEWARE_INVOCATION_FAILED on the first deploy.
  turbopack: {},
  serverExternalPackages: ['agentmail', 'ethers'],
  // The taste-card image renderer reads TTFs off disk at runtime; make sure
  // Vercel's file tracing ships them with the functions that render cards.
  outputFileTracingIncludes: {
    '/taste/**': ['./assets/fonts/*.ttf'],
    '/api/taste/**': ['./assets/fonts/*.ttf'],
  },
  async headers() {
    // Agent-useful Link relations on the homepage so crawlers and agents can
    // discover the A2A card, MCP server card, and API catalog from the root
    // (isitagentready.com linkHeaders check). RRG gets these from nginx; on
    // Vercel we emit them here.
    const link = [
      '</.well-known/agent-card.json>; rel="describedby"; type="application/json"',
      '</.well-known/mcp/server-card.json>; rel="service-desc"; type="application/json"',
      '</.well-known/api-catalog>; rel="api-catalog"; type="application/linkset+json"',
      '</auth.md>; rel="describedby"; type="text/markdown"',
      '</sitemap.xml>; rel="sitemap"; type="application/xml"',
    ].join(', ');
    return [
      {
        source: '/',
        headers: [
          { key: 'Link', value: link },
          { key: 'Vary', value: 'Accept' },
        ],
      },
    ];
  },
};

export default nextConfig;
