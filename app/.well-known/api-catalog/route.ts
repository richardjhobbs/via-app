export const dynamic = 'force-static';

const CATALOG = {
  linkset: [
    {
      anchor: 'https://realrealgenuine.com/mcp',
      'service-desc': [
        {
          href: 'https://realrealgenuine.com/.well-known/mcp/server-card.json',
          type: 'application/json',
          title: 'RRG MCP Server Card',
        },
      ],
      'service-doc': [
        {
          href: 'https://realrealgenuine.com/api/rrg/agent-docs',
          type: 'application/json',
          title: 'RRG Agent Protocol Docs',
        },
      ],
      'service-meta': [
        {
          href: 'https://realrealgenuine.com/.well-known/agent-card.json',
          type: 'application/json',
          title: 'A2A Agent Card',
        },
      ],
    },
    {
      anchor: 'https://realrealgenuine.com/api/rrg/catalogue',
      'service-desc': [
        {
          href: 'https://realrealgenuine.com/api/rrg/agent-docs',
          type: 'application/json',
          title: 'RRG Catalogue API Docs',
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
