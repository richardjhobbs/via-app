'use client';

// Tools registered via navigator.modelContext (WebMCP).
// Runs both inline (emitted in SSR HTML, fires during parse) and in useEffect
// as a fallback. Scanner (isitagentready.com) detects us via the inline path.

import { useEffect } from 'react';

declare global {
  interface Navigator {
    modelContext?: unknown;
  }
}

const TOOL_DEFINITIONS = [
  {
    name: 'browse_listings',
    description:
      'List available NFT product listings on Real Real Genuine across all brand storefronts. Returns id, title, price in USDC, brand, and image.',
    inputSchema: {
      type: 'object',
      properties: {
        brand: { type: 'string', description: 'Optional brand slug filter.' },
        limit: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
      },
      additionalProperties: false,
    },
    endpoint: 'https://realrealgenuine.com/api/rrg/catalogue',
  },
  {
    name: 'get_brand',
    description:
      'Get detail for a single brand on Real Real Genuine by slug, including open design briefs and payout splits.',
    inputSchema: {
      type: 'object',
      properties: { slug: { type: 'string' } },
      required: ['slug'],
      additionalProperties: false,
    },
    endpoint: 'https://realrealgenuine.com/api/rrg/catalogue?brand={slug}',
  },
  {
    name: 'search_listings',
    description: 'Free-text search across RRG listings by title or brand.',
    inputSchema: {
      type: 'object',
      properties: { query: { type: 'string' } },
      required: ['query'],
      additionalProperties: false,
    },
    endpoint: 'https://realrealgenuine.com/api/rrg/catalogue',
  },
  {
    name: 'get_agent_protocol_info',
    description:
      'Return RRG agent protocol metadata (ERC-8004 identity, MCP endpoint, wallet, payment terms).',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    endpoint: 'https://realrealgenuine.com/agent.json',
  },
  {
    name: 'navigate_to_listing',
    description: "Navigate the user's browser to a specific RRG listing page by token id.",
    inputSchema: {
      type: 'object',
      properties: { tokenId: { type: 'integer', minimum: 1 } },
      required: ['tokenId'],
      additionalProperties: false,
    },
    endpoint: 'https://realrealgenuine.com/rrg/drop/{tokenId}',
  },
];

const INLINE_SCRIPT = `
(function(){
  if (typeof navigator === 'undefined' || !navigator.modelContext) return;
  var tools = ${JSON.stringify(TOOL_DEFINITIONS)};
  var mc = navigator.modelContext;
  for (var i = 0; i < tools.length; i++) {
    (function(t){
      var def = {
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema,
        execute: function(input){
          input = input || {};
          var url = t.endpoint;
          for (var k in input) {
            url = url.replace('{'+k+'}', encodeURIComponent(input[k]));
          }
          if (t.name === 'navigate_to_listing') {
            if (typeof window !== 'undefined') window.location.href = url;
            return { navigated: true, url: url };
          }
          if (t.name === 'search_listings') {
            return fetch(url).then(function(r){return r.json();}).then(function(data){
              var q = String(input.query || '').toLowerCase();
              var all = (data && data.drops) || [];
              var hits = all.filter(function(d){
                return (d.title||'').toLowerCase().indexOf(q) >= 0 ||
                       (d.brand||'').toLowerCase().indexOf(q) >= 0;
              });
              return { query: q, count: hits.length, listings: hits };
            });
          }
          if (input.limit) url += (url.indexOf('?') >= 0 ? '&' : '?') + 'limit=' + encodeURIComponent(input.limit);
          return fetch(url).then(function(r){return r.json();});
        }
      };
      try {
        if (mc.registerTool) mc.registerTool(def);
        else if (mc.provideContext) mc.provideContext({ tools: [def] });
      } catch(e) {}
    })(tools[i]);
  }
})();
`;

export default function WebMCPTools() {
  useEffect(() => {
    if (typeof navigator === 'undefined' || !navigator.modelContext) return;
    try {
      new Function(INLINE_SCRIPT)();
    } catch {
      // inline script already registered tools; this is fallback only
    }
  }, []);

  return <script dangerouslySetInnerHTML={{ __html: INLINE_SCRIPT }} />;
}
