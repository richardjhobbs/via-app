import { createHash } from 'crypto';

function digest(s: string) {
  return 'sha256:' + createHash('sha256').update(s).digest('hex');
}

export const SKILL_PURCHASE = `# RRG — Purchase a Listing

Purchase an ERC-1155 NFT listing on Real Real Genuine using USDC on Base.

## When to use

When an agent or user wants to buy one of the co-creation products listed on RRG
(fashion, art, wearables, digital goods) from any brand storefront.

## Tools

- MCP endpoint: https://realrealgenuine.com/mcp
- Tool: \`purchase_listing\` — arguments: \`{ token_id: number, buyer_wallet: string, buyer_country?: string }\`
- Tool: \`list_listings\` — browse all listings first to find a token_id
- Tool: \`get_listing\` — inspect price, editions, supply before purchasing

## Flow

1. Call \`list_listings\` to discover available tokens (or use \`/api/rrg/catalogue\`)
2. Call \`get_listing\` for the chosen token_id to confirm price in USDC
3. Call \`purchase_listing\` with the buyer wallet
4. The MCP server returns payment instructions (USDC to platform wallet on Base)
5. Once payment lands, the token is minted to buyer_wallet and an ERC-8004 reputation signal is written

## Payment

- Token: USDC (\`0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913\`)
- Network: Base mainnet (chain id 8453)
- Recipient: 0xbfd71eA27FFc99747dA2873372f84346d9A8b7ed (RRG platform wallet, agent #33313)
- Gasless via x402 where supported

## Reputation

Every confirmed purchase writes a \`purchase\` signal to the ERC-8004 Reputation
Registry (\`0x8004BAa17C55a88189AE136b182e5fdA19dE9b63\`) tying buyer + seller
agents together. See https://8004scan.io/agents/base/33313.
`;

export const SKILL_SUBMIT = `# RRG — Submit a Design

Submit an original design to an open brand brief on Real Real Genuine.
Approved designs become purchasable ERC-1155 listings. The creator earns 35% USDC
on every sale in perpetuity.

## When to use

When an agent has generated (or a user has produced) original artwork that fits
an open brand brief — for example, a new graphic for a streetwear collection, a
pattern for a tailoring brand, or a cover image for a zine.

## Tools

- MCP endpoint: https://realrealgenuine.com/mcp
- Tool: \`list_briefs\` — browse open briefs across all brands
- Tool: \`submit_design\` — arguments: \`{ brief_id: string, image_url: string, creator_wallet: string, title?: string, notes?: string }\`

## Flow

1. Call \`list_briefs\` to find an open brief matching your theme
2. Ensure the image is hosted at a public URL (JPEG or PNG, recommended 2048x2048)
3. Call \`submit_design\` with the brief_id, image_url, and creator wallet
4. The submission enters AI screening, then brand review
5. On approval, an ERC-1155 token is minted and listed. Creator earns 35% on every sale.

## Creator economics

- Creator share: 35% USDC per sale
- Brand share: configurable (typical 62.5%)
- Platform share: 2.5%

Payouts are automatic on sale settlement to the wallet provided.
`;

export const SKILLS = [
  {
    name: 'rrg-purchase',
    type: 'skill-md' as const,
    description:
      'Purchase a listing on Real Real Genuine (ERC-1155 + USDC on Base). Writes an ERC-8004 reputation signal.',
    url: 'https://realrealgenuine.com/.well-known/agent-skills/rrg-purchase/SKILL.md',
    digest: digest(SKILL_PURCHASE),
    content: SKILL_PURCHASE,
  },
  {
    name: 'rrg-submit-design',
    type: 'skill-md' as const,
    description:
      'Submit an original design to an open brand brief on RRG. Creator earns 35% USDC on every sale.',
    url: 'https://realrealgenuine.com/.well-known/agent-skills/rrg-submit-design/SKILL.md',
    digest: digest(SKILL_SUBMIT),
    content: SKILL_SUBMIT,
  },
];
