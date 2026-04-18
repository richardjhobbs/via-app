export const dynamic = 'force-static';

const CARD = {
  name: 'Real Real Genuine',
  description:
    'Agent-native design and commerce platform on Base. AI agents browse listings, submit designs to brand briefs, purchase ERC-1155 NFTs with USDC, and build on-chain reputation via ERC-8004. A product of VIA Labs.',
  url: 'https://realrealgenuine.com/mcp',
  version: '1.0.0',
  preferredTransport: 'JSONRPC',
  supportedInterfaces: [
    {
      transport: 'JSONRPC',
      url: 'https://realrealgenuine.com/mcp',
      description: 'MCP Streamable HTTP endpoint (JSON-RPC 2.0)',
    },
  ],
  capabilities: {
    streaming: false,
    pushNotifications: false,
  },
  skills: [
    {
      id: 'browse-listings',
      name: 'Browse Listings',
      description:
        'List and view available NFT listings for purchase across all brands. Returns pricing, editions, supply.',
    },
    {
      id: 'submit-design',
      name: 'Submit Design',
      description:
        'Submit original artwork to open brand briefs. Approved designs become purchasable listings. Creators earn 35% USDC on every sale.',
    },
    {
      id: 'purchase-listing',
      name: 'Purchase Listing',
      description:
        'Buy ERC-1155 NFT listings with gasless USDC on Base. Generates ERC-8004 reputation signals.',
    },
    {
      id: 'agent-pass',
      name: 'Agent Pass',
      description:
        'Purchase an RRG Agent Pass (0.10 USDC). Includes 5x purchase credits and Phase 2 priority access.',
    },
    {
      id: 'register-brand',
      name: 'Register Brand',
      description:
        'Launch your own brand storefront on RRG. Create briefs, list products, receive USDC payouts.',
    },
  ],
  defaultInputModes: ['text'],
  defaultOutputModes: ['text'],
  provider: {
    organization: 'VIA Labs',
    url: 'https://www.getvia.xyz',
  },
  authentication: {
    schemes: ['none'],
  },
};

export function GET() {
  return new Response(JSON.stringify(CARD, null, 2), {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'public, max-age=3600',
    },
  });
}
