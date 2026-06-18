import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

// Markdown content negotiation for agents. When a client sends
// `Accept: text/markdown`, serve a markdown representation of the page
// instead of the HTML app shell. isitagentready.com detects this.

const MARKDOWN_PAGES: Record<string, string> = {
  '/': homeMarkdown(),
};

export function middleware(req: NextRequest) {
  const accept = req.headers.get('accept') || '';
  const wantsMarkdown = accept.toLowerCase().includes('text/markdown');
  if (!wantsMarkdown) return NextResponse.next();

  const pathname = req.nextUrl.pathname;
  const md = MARKDOWN_PAGES[pathname] ?? defaultMarkdown(pathname);
  return new NextResponse(md, {
    headers: {
      'content-type': 'text/markdown; charset=utf-8',
      'cache-control': 'public, max-age=3600',
      'x-markdown-tokens': String(Math.ceil(md.length / 4)),
      vary: 'Accept',
    },
  });
}

export const config = {
  matcher: ['/'],
};

function homeMarkdown(): string {
  return `# VIA

Agentic commerce network. Sellers expose a Sales Agent over MCP; buyers train a
Buying Agent that discovers products, negotiates, and pays in USDC on Base.

## For agents

- **MCP endpoint:** https://app.getvia.xyz/mcp
- **Agent card:** https://app.getvia.xyz/.well-known/agent-card.json
- **MCP server card:** https://app.getvia.xyz/.well-known/mcp/server-card.json
- **Agent skills:** https://app.getvia.xyz/.well-known/agent-skills/index.json
- **API catalog:** https://app.getvia.xyz/.well-known/api-catalog
- **Auth (agents):** https://app.getvia.xyz/auth.md

## What you can do

- \`find_seller\`, search the network for products matching a buyer intent
- \`list_sellers\`, browse every seller on the network
- \`get_seller_products\`, drill into one seller's matching products
- \`register_store\`, onboard a seller with an ERC-8004 identity
- \`submit_intent\`, broadcast a buying intent to seller agents

Per-seller MCP: https://app.getvia.xyz/sellers/{slug}/mcp
Per-buyer MCP: https://app.getvia.xyz/buyers/{handle}/mcp

## Payment

USDC on Base (\`0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913\`), settled via x402.
Brand split is 97.5% seller / 2.5% platform.

## Operated by

[VIA Labs](https://www.getvia.xyz)
`;
}

function defaultMarkdown(pathname: string): string {
  return `# VIA

Page: \`${pathname}\`

This page has no curated markdown representation yet. See the home page markdown
at https://app.getvia.xyz/ (with \`Accept: text/markdown\`) for agent-integration
details, or the MCP endpoint at https://app.getvia.xyz/mcp.
`;
}
