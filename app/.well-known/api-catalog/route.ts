export const dynamic = 'force-static';

const APP_BASE = 'https://app.getvia.xyz';

const CATALOG = {
  linkset: [
    {
      anchor: `${APP_BASE}/mcp`,
      'service-desc': [
        {
          href: `${APP_BASE}/.well-known/mcp/server-card.json`,
          type: 'application/json',
          title: 'VIA MCP Server Card',
        },
      ],
      'service-meta': [
        {
          href: `${APP_BASE}/.well-known/agent-card.json`,
          type: 'application/json',
          title: 'A2A Agent Card',
        },
      ],
    },
    {
      anchor: `${APP_BASE}/sellers/{slug}/mcp`,
      'service-desc': [
        {
          href: `${APP_BASE}/.well-known/mcp/server-card.json`,
          type: 'application/json',
          title: 'Per-seller MCP — same tool surface as documented in the server card under per_seller_mcp_tools.',
        },
      ],
    },
  ],
};

export function GET() {
  return new Response(JSON.stringify(CATALOG, null, 2), {
    headers: {
      'content-type': 'application/linkset+json',
      'cache-control': 'public, max-age=3600',
    },
  });
}
