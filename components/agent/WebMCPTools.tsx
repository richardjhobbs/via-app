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
    name: 'find_products',
    description:
      'Search the VIA network for products matching a buyer intent across all sellers. Returns ranked products with seller, title, price in USDC, and a link to transact.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Plain-language buyer intent.' },
        limit: { type: 'integer', minimum: 1, maximum: 50, default: 10 },
      },
      required: ['query'],
      additionalProperties: false,
    },
    endpoint: 'https://app.getvia.xyz/api/via/search?q={query}',
  },
  {
    name: 'get_agent_card',
    description:
      'Return the VIA A2A agent card (MCP endpoint, payment terms, supported extensions).',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    endpoint: 'https://app.getvia.xyz/.well-known/agent-card.json',
  },
  {
    name: 'navigate_to_search',
    description: "Navigate the user's browser to the VIA search results for a query.",
    inputSchema: {
      type: 'object',
      properties: { query: { type: 'string' } },
      required: ['query'],
      additionalProperties: false,
    },
    endpoint: 'https://app.getvia.xyz/?q={query}',
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
          if (t.name === 'navigate_to_search') {
            if (typeof window !== 'undefined') window.location.href = url;
            return { navigated: true, url: url };
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
