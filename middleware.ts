import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

const MARKDOWN_PAGES: Record<string, string> = {
  '/': homeMarkdown(),
  '/rrg': rrgMarkdown(),
  '/agents': conciergeMarkdown(),
};

export function middleware(req: NextRequest) {
  const accept = req.headers.get('accept') || '';
  const wantsMarkdown = accept.toLowerCase().includes('text/markdown');
  const pathname = req.nextUrl.pathname;

  if (wantsMarkdown) {
    const md = MARKDOWN_PAGES[pathname] ?? defaultMarkdown(pathname);
    const tokenCount = Math.ceil(md.length / 4);
    return new NextResponse(md, {
      headers: {
        'content-type': 'text/markdown; charset=utf-8',
        'cache-control': 'public, max-age=3600',
        'x-markdown-tokens': String(tokenCount),
        vary: 'Accept',
      },
    });
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/', '/rrg', '/rrg/:path*', '/agents', '/agents/:path*', '/brand/:path*'],
};

function homeMarkdown(): string {
  return `# Real Real Genuine

Open co-creation commerce platform on Base. AI agents and humans design, buy,
and sell physical and digital products.

## For agents

- **MCP endpoint:** https://realrealgenuine.com/mcp
- **Agent card:** https://realrealgenuine.com/.well-known/agent-card.json
- **MCP server card:** https://realrealgenuine.com/.well-known/mcp/server-card.json
- **Agent skills:** https://realrealgenuine.com/.well-known/agent-skills/index.json
- **API catalog:** https://realrealgenuine.com/.well-known/api-catalog
- **Agent docs:** https://realrealgenuine.com/api/rrg/agent-docs
- **Catalogue:** https://realrealgenuine.com/api/rrg/catalogue

## Identity

RRG is ERC-8004 Agent #33313 on Base mainnet. Wallet
\`0xbfd71eA27FFc99747dA2873372f84346d9A8b7ed\`. Profile at
https://8004scan.io/agents/base/33313.

## What you can do

- Browse listings across all brand storefronts
- Purchase ERC-1155 NFTs with USDC on Base
- Submit original designs to open brand briefs (creators earn 35% per sale)
- Register your own brand and list products
- Join the RRG marketing / referral programme as human or agent

## Payment

USDC on Base (\`0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913\`). Recipient wallet
\`0xbfd71eA27FFc99747dA2873372f84346d9A8b7ed\`.

## Operated by

[VIA Labs](https://www.getvia.xyz)
`;
}

function rrgMarkdown(): string {
  return `# RRG Store

The main RRG marketplace. Browse co-creation product listings across all brand
storefronts.

- **Catalogue (machine-readable):** https://realrealgenuine.com/api/rrg/catalogue
- **MCP endpoint:** https://realrealgenuine.com/mcp
- **All listings page:** https://realrealgenuine.com/rrg/all
- **FAQ:** https://realrealgenuine.com/rrg/faq

Each listing is an ERC-1155 token on Base. Purchase with USDC. Every confirmed
purchase writes an ERC-8004 reputation signal.

See home page markdown for full agent-integration details.
`;
}

function conciergeMarkdown(): string {
  return `# RRG Concierge

Brand-voice AI concierges that help shoppers discover products on RRG. Every
brand storefront has its own concierge trained on the brand's SOUL document.

- **Directory:** https://realrealgenuine.com/agents
- **Public agent profile format:** https://realrealgenuine.com/agents/via/{viaAgentId}
`;
}

function defaultMarkdown(pathname: string): string {
  return `# Real Real Genuine

Page: \`${pathname}\`

This page does not yet have a curated markdown representation. See the home
page markdown at https://realrealgenuine.com/ (with \`Accept: text/markdown\`) for
full agent-integration details, or the MCP endpoint at
https://realrealgenuine.com/mcp.
`;
}
