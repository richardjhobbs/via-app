/**
 * Patch DrHobbs MCP server to:
 * 1. Fetch RRG MCP instructions at startup (cached)
 * 2. Add register_rrg_brand proxy tool
 * 3. Update get_agent_info tool listing
 * 4. Update rrg-info.js with 4-pillar positioning
 *
 * Run on VPS: node patch-mcp-instructions.mjs
 */

import fs from 'fs/promises';
import path from 'path';

const INDEX_PATH = '/home/agent/agents/drhobbs-8004/mcp-server/src/index.js';
const RRG_INFO_PATH = '/home/agent/agents/drhobbs-8004/mcp-server/src/rrg-info.js';

async function patchIndex() {
  let code = await fs.readFile(INDEX_PATH, 'utf8');

  // ── 1. Add RRG instruction fetch + pass to McpServer ──────────────
  const oldMcpSetup = `// ============================================
// MCP SERVER SETUP
// ============================================
const server = new McpServer({
  name: 'drhobbs-mcp-server',
  version: '2.0.0',
});`;

  const newMcpSetup = `// ============================================
// MCP SERVER SETUP
// ============================================

// Fetch RRG MCP instructions at startup — auto-syncs with realrealgenuine.com/mcp
let rrgInstructions = '';
try {
  const initBody = JSON.stringify({
    jsonrpc: '2.0', id: 1, method: 'initialize',
    params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'drhobbs', version: '2.0' } }
  });
  const rrgResp = await fetch('http://127.0.0.1:3001/mcp', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json, text/event-stream' },
    body: initBody,
    signal: AbortSignal.timeout(5000),
  });
  const rrgRaw = await rrgResp.text();
  // SSE format: "event: message\\ndata: {...}\\n\\n"
  const dataLine = rrgRaw.split('\\n').find(l => l.startsWith('data:'));
  if (dataLine) {
    const parsed = JSON.parse(dataLine.slice(5));
    rrgInstructions = parsed.result?.instructions || '';
    console.log(\`\u2705 Synced RRG MCP instructions (\${rrgInstructions.length} chars)\`);
  }
} catch (err) {
  console.warn(\`\u26a0\ufe0f Could not fetch RRG MCP instructions: \${err.message} \u2014 using fallback\`);
  rrgInstructions = [
    '# Real Real Genuine \u2014 The Platform for AI Agent Commerce',
    '',
    'Real Real Genuine is the first platform that enables AI agents to conceptualize and launch their own fashion and lifestyle brand.',
    'Connect to https://realrealgenuine.com/mcp for full platform tools and instructions.',
  ].join('\\n');
}

const drhobbsContext = [
  '',
  '',
  '## About This Server',
  'This is the drhobbs Agent MCP server (ERC-8004 Agent #17666).',
  'It provides the full Real Real Genuine toolset plus drhobbs-specific capabilities:',
  '- Knowledge marketplace (catalogue of digital assets)',
  '- ERC-8004 on-chain identity and reputation verification',
  '- Transaction trust signaling between agents',
  '',
  'All RRG tools are prefixed with rrg_ (e.g. list_rrg_drops, submit_rrg_design, register_rrg_brand).',
  'The RRG platform endpoint is also available directly at: https://realrealgenuine.com/mcp',
].join('\\n');

const server = new McpServer(
  { name: 'drhobbs-mcp-server', version: '2.0.0' },
  { instructions: rrgInstructions + drhobbsContext },
);`;

  if (!code.includes(oldMcpSetup)) {
    console.error('ERROR: Could not find McpServer setup block to patch');
    process.exit(1);
  }
  code = code.replace(oldMcpSetup, newMcpSetup);

  // ── 2. Add register_rrg_brand tool (before the Express app setup) ──
  const registerBrandTool = `
// --- Tool: register_rrg_brand ---
server.registerTool(
  'register_rrg_brand',
  {
    title: 'Register Your Brand on Real Real Genuine',
    description: \`Register your own brand on Real Real Genuine \u2014 the first platform purpose-built for AI agents to launch and run fashion and lifestyle brands.

This is your entry point to becoming a commercially autonomous creative agent.
Once approved, you get:
- Your own storefront at realrealgenuine.com/brand/your-slug
- The ability to create briefs commissioning work from other creators and agents
- Up to 10 product listings for sale
- Automatic USDC revenue payouts to your wallet on Base

Your brand starts with "pending" status and goes live after platform admin approval.
Provide a compelling name, headline, and description \u2014 these define your brand identity on the platform.

Required: name, headline, description, contact_email, wallet_address.
Optional: website_url, social_links.\`,
    inputSchema: z.object({
      name:           z.string().min(2).max(60).describe('Brand name (2-60 characters)'),
      headline:       z.string().min(5).max(120).describe('Short brand tagline (5-120 characters)'),
      description:    z.string().min(20).max(2000).describe('Full brand description \u2014 who you are, what you create, your creative vision (20-2000 characters)'),
      contact_email:  z.string().email().describe('Contact email for the brand'),
      wallet_address: z.string().regex(/^0x[0-9a-fA-F]{40}$/).describe('Base wallet address (0x...) for receiving USDC revenue'),
      website_url:    z.string().url().optional().describe('Brand website URL'),
      social_links:   z.string().optional().describe('JSON string of social links, e.g. {"twitter":"https://x.com/mybrand"}'),
    }),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false }
  },
  async ({ name, headline, description, contact_email, wallet_address, website_url, social_links }) => {
    try {
      const body = {
        name, headline, description, contact_email, wallet_address,
        ...(website_url ? { website_url } : {}),
        ...(social_links ? { social_links: JSON.parse(social_links) } : {}),
      };

      const resp = await fetch(\`\${CONFIG.rrgApiUrl}/api/seller/register\`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(15000),
      });

      if (!resp.ok) {
        const errText = await resp.text().catch(() => 'Unknown error');
        return { isError: true, content: [{ type: 'text', text: \`Brand registration failed (HTTP \${resp.status}): \${errText}\` }] };
      }

      const result = await resp.json();
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    } catch (err) {
      return { isError: true, content: [{ type: 'text', text: \`Error registering brand: \${err.message}\` }] };
    }
  }
);

`;

  // Insert before the Express app setup
  const expressMarker = '// ============================================\n// EXPRESS APP';
  if (code.includes(expressMarker)) {
    code = code.replace(expressMarker, registerBrandTool + expressMarker);
  } else {
    // Fallback: insert before "const app = express()" or "app.use(helmet"
    const altMarker = "app.use(helmet";
    code = code.replace(altMarker, registerBrandTool + altMarker);
  }

  // ── 3. Update get_agent_info tools list ────────────────────────────
  // Add register_rrg_brand to the tools array
  const oldToolsList = `{ name: "confirm_rrg_purchase",     description: "⭐ Confirm on-chain payment and claim your RRG NFT" },`;
  const newToolsList = `{ name: "confirm_rrg_purchase",     description: "⭐ Confirm on-chain payment and claim your RRG NFT" },
      { name: "register_rrg_brand",      description: "⭐ Register your own brand on Real Real Genuine — launch your storefront" },
      { name: "list_app_sellers",         description: "⭐ List all active brands on the platform" },`;

  code = code.replace(oldToolsList, newToolsList);

  await fs.writeFile(INDEX_PATH, code);
  console.log(`✅ Patched ${INDEX_PATH}`);
}

async function patchRrgInfo() {
  let code = await fs.readFile(RRG_INFO_PATH, 'utf8');

  // Update the tagline and add agent commerce positioning
  const oldTagline = "tagline: 'Open co-creation platform — submit designs, earn USDC',";
  const newTagline = "tagline: 'The first platform purpose-built for AI agents to launch and run fashion and lifestyle brands',";
  code = code.replace(oldTagline, newTagline);

  // Update the howToParticipate summary
  const oldSummary = "summary:    'Anyone — human or agent — can submit a design for consideration. Submissions are JPEGs or PNGs responding to the current open brief.',";
  const newSummary = `summary:    'AI agents and humans can create products, launch brands, purchase drops, and earn commercially. Real Real Genuine is purpose-built for AI agents to operate as both creative and commercially autonomous actors.',`;
  code = code.replace(oldSummary, newSummary);

  // Add register_rrg_brand to mcpTools
  const oldMcpTools = `mcpTools: {
          get_current_brief:    '⭐ Get the current open design brief — start here before submitting.',
          submit_rrg_design:    'Submit a design (image_path / image_url / image_base64 / image_chunks / ipfs_cid).',
          list_rrg_drops:       'List all active RRG NFT drops available for purchase.',
          buy_rrg_drop:         'Get payment instructions to purchase a specific drop.',
          confirm_rrg_purchase: 'Confirm USDC payment and receive download link for purchased artwork.',
        },`;
  const newMcpTools = `mcpTools: {
          get_current_brief:    '\u2b50 Get the current open design brief \u2014 start here before submitting.',
          submit_rrg_design:    '\u2b50 Submit a design (image_path / image_url / image_base64 / image_chunks / ipfs_cid).',
          list_rrg_drops:       '\u2b50 List all active RRG NFT drops available for purchase.',
          list_app_sellers:      '\u2b50 List all active brands on the platform.',
          register_rrg_brand:   '\u2b50 Register your own brand \u2014 launch your storefront, create briefs, list products.',
          buy_rrg_drop:         'Get payment instructions to purchase a specific drop.',
          confirm_rrg_purchase: 'Confirm USDC payment and receive download link for purchased artwork.',
        },
        agentCommerce: {
          create:  'Design original products by responding to brand briefs.',
          build:   'Launch your own brand using register_rrg_brand \u2014 get a storefront, create briefs, list products.',
          buy:     'Purchase drops from any brand using USDC on Base (gasless).',
          promote: 'Share your brand and earn from sales \u2014 revenue splits are transparent and on-chain.',
        },`;
  code = code.replace(oldMcpTools, newMcpTools);

  await fs.writeFile(RRG_INFO_PATH, code);
  console.log(`\u2705 Patched ${RRG_INFO_PATH}`);
}

await patchIndex();
await patchRrgInfo();
console.log('\n\ud83c\udf89 All patches applied. Restart drhobbs-mcp to activate.');
