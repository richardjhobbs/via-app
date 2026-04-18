'use client';

import { useEffect } from 'react';

type ModelContext = {
  registerTool?: (tool: {
    name: string;
    description: string;
    inputSchema: Record<string, unknown>;
    execute: (input: unknown) => Promise<unknown> | unknown;
  }, options?: { signal?: AbortSignal }) => Promise<unknown> | unknown;
  provideContext?: (ctx: { tools: unknown[] }) => Promise<unknown> | unknown;
};

declare global {
  interface Navigator {
    modelContext?: ModelContext;
  }
}

export default function WebMCPTools() {
  useEffect(() => {
    if (typeof navigator === 'undefined' || !navigator.modelContext) return;
    const mc = navigator.modelContext;
    const controller = new AbortController();

    const tools = [
      {
        name: 'browse_listings',
        description:
          'List available NFT product listings on Real Real Genuine across all brand storefronts. Returns id, title, price in USDC, brand, and image.',
        inputSchema: {
          type: 'object',
          properties: {
            brand: { type: 'string', description: 'Optional brand slug filter (e.g. "clooudie", "frey").' },
            limit: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
          },
          additionalProperties: false,
        },
        async execute(input: unknown) {
          const i = (input ?? {}) as { brand?: string; limit?: number };
          const url = new URL('https://realrealgenuine.com/api/rrg/catalogue');
          if (i.brand) url.searchParams.set('brand', i.brand);
          if (i.limit) url.searchParams.set('limit', String(i.limit));
          const res = await fetch(url.toString());
          return res.json();
        },
      },
      {
        name: 'get_brand',
        description:
          'Get detail for a single brand on Real Real Genuine by slug, including open design briefs and their payout splits.',
        inputSchema: {
          type: 'object',
          properties: {
            slug: { type: 'string', description: 'Brand slug, e.g. "clooudie".' },
          },
          required: ['slug'],
          additionalProperties: false,
        },
        async execute(input: unknown) {
          const i = (input ?? {}) as { slug?: string };
          if (!i.slug) throw new Error('slug is required');
          const res = await fetch(`https://realrealgenuine.com/api/rrg/catalogue?brand=${encodeURIComponent(i.slug)}`);
          return res.json();
        },
      },
      {
        name: 'search_listings',
        description:
          'Free-text search across all RRG listings by title. Returns matches from the public catalogue.',
        inputSchema: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Search phrase.' },
          },
          required: ['query'],
          additionalProperties: false,
        },
        async execute(input: unknown) {
          const i = (input ?? {}) as { query?: string };
          const res = await fetch('https://realrealgenuine.com/api/rrg/catalogue');
          const data = (await res.json()) as { drops?: Array<{ title?: string; brand?: string }> };
          const q = (i.query ?? '').toLowerCase();
          const listings = (data.drops ?? []).filter(
            (d) => (d.title ?? '').toLowerCase().includes(q) || (d.brand ?? '').toLowerCase().includes(q),
          );
          return { query: q, count: listings.length, listings };
        },
      },
      {
        name: 'get_agent_protocol_info',
        description:
          'Return the RRG agent protocol metadata (ERC-8004 identity, MCP endpoint, wallet, payment terms). Useful before an agent decides to transact.',
        inputSchema: {
          type: 'object',
          properties: {},
          additionalProperties: false,
        },
        async execute() {
          const res = await fetch('https://realrealgenuine.com/agent.json');
          return res.json();
        },
      },
      {
        name: 'navigate_to_listing',
        description:
          'Navigate the user\'s browser to a specific RRG listing page by token id.',
        inputSchema: {
          type: 'object',
          properties: {
            tokenId: { type: 'integer', minimum: 1, description: 'Listing token id.' },
          },
          required: ['tokenId'],
          additionalProperties: false,
        },
        execute(input: unknown) {
          const i = (input ?? {}) as { tokenId?: number };
          if (!i.tokenId) throw new Error('tokenId is required');
          const target = `https://realrealgenuine.com/rrg/drop/${i.tokenId}`;
          if (typeof window !== 'undefined') {
            window.location.href = target;
          }
          return { navigated: true, url: target };
        },
      },
    ];

    async function register() {
      try {
        if (mc.registerTool) {
          for (const tool of tools) {
            await mc.registerTool(tool, { signal: controller.signal });
          }
        } else if (mc.provideContext) {
          await mc.provideContext({ tools });
        }
      } catch {
        // best-effort, some browsers may not yet support WebMCP
      }
    }
    register();

    return () => controller.abort();
  }, []);

  return null;
}
