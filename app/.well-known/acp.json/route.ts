export const dynamic = 'force-static';

const ACP = {
  protocol: {
    name: 'acp',
    version: '1.0',
  },
  api_base_url: 'https://realrealgenuine.com',
  transports: ['mcp', 'https'],
  capabilities: {
    services: [
      {
        id: 'browse-listings',
        name: 'Browse Listings',
        description:
          'List and view available NFT listings for purchase across all brand storefronts.',
        endpoint: 'https://realrealgenuine.com/api/rrg/catalogue',
      },
      {
        id: 'purchase-listing',
        name: 'Purchase Listing',
        description:
          'Buy an ERC-1155 NFT listing with USDC on Base. Writes an ERC-8004 reputation signal.',
        endpoint: 'https://realrealgenuine.com/mcp',
      },
      {
        id: 'submit-design',
        name: 'Submit Design',
        description:
          'Submit an original design to an open brand brief. Approved designs become listings.',
        endpoint: 'https://realrealgenuine.com/mcp',
      },
      {
        id: 'register-brand',
        name: 'Register Brand',
        description: 'Launch your own brand storefront on RRG.',
        endpoint: 'https://realrealgenuine.com/mcp',
      },
    ],
  },
  payment: {
    methods: ['x402', 'usdc-base'],
    token: 'USDC',
    contract: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    network: 'base-mainnet',
    recipient: '0xbfd71eA27FFc99747dA2873372f84346d9A8b7ed',
  },
  identity: {
    standard: 'erc-8004',
    agentId: 33313,
    network: 'base',
    profile: 'https://8004scan.io/agents/base/33313',
  },
  provider: {
    name: 'Real Real Genuine',
    organization: 'VIA Labs',
    url: 'https://www.getvia.xyz',
  },
};

export function GET() {
  return new Response(JSON.stringify(ACP, null, 2), {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'public, max-age=3600',
    },
  });
}
