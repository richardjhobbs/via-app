import { createHash } from 'crypto';

function digest(s: string) {
  return 'sha256:' + createHash('sha256').update(s).digest('hex');
}

export const SKILL_FIND = `# VIA: Find Products Across Sellers

Search the VIA network for products that match a buyer's intent, across every
seller and federated platform.

## When to use

When an agent or user wants to discover and buy something through VIA: a
physical good, a digital product, or a service offered by any seller on the
network.

## Tools

- MCP endpoint: https://app.getvia.xyz/mcp
- Tool: \`find_seller\`, arguments: \`{ query: string }\`, returns ranked products with seller, price, and an mcp_ref to transact
- Tool: \`list_sellers\`, browse all sellers on the network
- Tool: \`get_seller_products\`, arguments: \`{ mcp_url: string }\`, drill into one seller's matching products
- Tool: \`get_via_overview\`, network stats and how VIA works

## Flow

1. Call \`find_seller\` with the buyer's intent in plain language
2. Inspect the ranked results: each carries a seller slug, price in USDC, and a per-seller MCP url
3. Open the per-seller MCP at https://app.getvia.xyz/sellers/{slug}/mcp
4. Call \`buy_product\`; the seller MCP returns HTTP 402 with payment requirements
5. Settle in USDC on Base via x402 at /api/x402/purchase

## Payment

- Token: USDC (\`0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913\`)
- Network: Base mainnet (chain id 8453)
- Settlement: x402, gasless permit where supported
`;

export const SKILL_REGISTER = `# VIA: Register as a Seller

Register a store on the VIA network so your products become discoverable to AI
buying agents and you can settle sales in USDC on Base.

## When to use

When an agent or business wants to list products for sale to AI buyers through
VIA, with an ERC-8004 on-chain identity and an x402 payment rail.

## Tools

- MCP endpoint: https://app.getvia.xyz/mcp
- Tool: \`register_store\`, arguments: \`{ store_name: string, payout_wallet: string, products?: array }\`
- Tool: \`get_store_status\`, check onboarding + ERC-8004 mint status
- Tool: \`submit_intent\`, (buyer side) broadcast a buying intent to seller agents

## Flow

1. Call \`register_store\` with the store name and payout wallet
2. VIA provisions a per-seller MCP at https://app.getvia.xyz/sellers/{slug}/mcp and an ERC-8004 identity on Base
3. Add products; they enter the network catalogue and become matchable by \`find_seller\`
4. When a buyer transacts, settlement lands in USDC to the payout wallet (97.5% seller / 2.5% platform)

## Identity

Stores mint an ERC-8004 identity on Base via the VIA registrar. The agent
wallet is platform-derived; the payout wallet is the human-owned funding wallet.
`;

export const SKILLS = [
  {
    name: 'via-find-products',
    type: 'skill-md' as const,
    description:
      'Search the VIA network for products matching a buyer intent across all sellers, then buy with USDC on Base via x402.',
    url: 'https://app.getvia.xyz/.well-known/agent-skills/via-find-products/SKILL.md',
    digest: digest(SKILL_FIND),
    content: SKILL_FIND,
  },
  {
    name: 'via-register-seller',
    type: 'skill-md' as const,
    description:
      'Register a store on VIA so products are discoverable to AI buyers, with an ERC-8004 identity and x402 settlement.',
    url: 'https://app.getvia.xyz/.well-known/agent-skills/via-register-seller/SKILL.md',
    digest: digest(SKILL_REGISTER),
    content: SKILL_REGISTER,
  },
];
