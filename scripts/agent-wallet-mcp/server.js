#!/usr/bin/env node
/**
 * agent-wallet-mcp — intrinsic wallet + generic MCP-call capability for any VIA agent.
 *
 * Drop-in MCP server that gives an agent the two primitives it needs to
 * transact anywhere on RRG (or any MCP-speaking seller): a wallet that
 * can sign and send USDC on Base mainnet, and a generic HTTP client that
 * can POST MCP tool calls to any URL.
 *
 * With this wired, agents like DrHobbs can autonomously:
 *   1. get_wallet                            → know my address + balance
 *   2. mcp_call list_drops { brand_slug }    → browse RRG catalogue
 *   3. send_usdc { to, amount_usd }          → pay on-chain
 *   4. mcp_call confirm_purchase { txHash }  → finalise + receive
 *
 * Env vars required:
 *   WALLET_PRIVATE_KEY   — hex private key of the agent's wallet (no 0x prefix accepted with or without)
 *   RPC_URL              — Base mainnet RPC (default: https://mainnet.base.org)
 *   USDC_ADDRESS         — Base USDC (default: 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913)
 *   CHAIN_ID             — default: 8453
 *   AGENT_LABEL          — optional human label surfaced in get_wallet (e.g. "DrHobbs #17666")
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { ethers } from 'ethers';

const RPC_URL      = process.env.RPC_URL      || 'https://mainnet.base.org';
const USDC_ADDRESS = process.env.USDC_ADDRESS || '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const CHAIN_ID     = parseInt(process.env.CHAIN_ID || '8453', 10);
const AGENT_LABEL  = process.env.AGENT_LABEL  || 'agent';
const PK           = process.env.WALLET_PRIVATE_KEY;

if (!PK) {
  console.error('[agent-wallet-mcp] FATAL: WALLET_PRIVATE_KEY not set');
  process.exit(1);
}

const provider = new ethers.JsonRpcProvider(RPC_URL);
const wallet   = new ethers.Wallet(PK.startsWith('0x') ? PK : '0x' + PK, provider);

const USDC_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function transfer(address,uint256) returns (bool)',
];
const usdc = new ethers.Contract(USDC_ADDRESS, USDC_ABI, wallet);

// ──────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────

function toUsdcBase(amountUsd) {
  // USDC has 6 decimals on Base mainnet.
  if (typeof amountUsd !== 'number' && typeof amountUsd !== 'string') {
    throw new Error('amount_usd must be a number or numeric string');
  }
  const parsed = ethers.parseUnits(String(amountUsd), 6);
  if (parsed <= 0n) throw new Error('amount_usd must be positive');
  return parsed;
}

async function sendMcpCall({ url, tool, arguments: args, timeout_ms = 30000 }) {
  const body = {
    jsonrpc: '2.0',
    id: Math.floor(Math.random() * 1_000_000),
    method: 'tools/call',
    params: { name: tool, arguments: args ?? {} },
  };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout_ms);
  try {
    const res = await fetch(url, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
      body:    JSON.stringify(body),
      signal:  controller.signal,
    });
    const text = await res.text();
    // Handle SSE-style response (some MCP servers wrap with `event: message\ndata: {...}`)
    let json;
    const sseMatch = text.match(/^data:\s*(\{[\s\S]*\})\s*$/m);
    if (sseMatch) {
      json = JSON.parse(sseMatch[1]);
    } else {
      try { json = JSON.parse(text); } catch { json = { raw: text }; }
    }
    return { httpStatus: res.status, ...json };
  } finally {
    clearTimeout(timer);
  }
}

// ──────────────────────────────────────────────────────────────────────
// MCP server
// ──────────────────────────────────────────────────────────────────────

const server = new Server(
  { name: 'agent-wallet-mcp', version: '0.1.0' },
  { capabilities: { tools: {} } },
);

const TOOLS = [
  {
    name: 'get_wallet',
    description: `Return this agent's wallet address, chain ID, USDC balance, and ETH balance on Base mainnet.`,
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'send_usdc',
    description: `Send USDC on Base mainnet from this agent's wallet to a recipient address. Use when paying a seller / platform (e.g. RRG platform wallet 0xbfd71eA27FFc99747dA2873372f84346d9A8b7ed for a drop purchase). Returns the on-chain transaction hash once confirmed.`,
    inputSchema: {
      type: 'object',
      required: ['to', 'amount_usd'],
      properties: {
        to:         { type: 'string', description: 'Recipient wallet address (0x-prefixed, checksummed or lowercase)' },
        amount_usd: { type: ['number', 'string'], description: 'Amount in USD (1:1 with USDC). Supports decimals (e.g. 15.00).' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'sign_message',
    description: `Produce an EIP-191 personal_sign signature over a message string using this agent's wallet. Use when a verifier asks the agent to prove ownership of its address.`,
    inputSchema: {
      type: 'object',
      required: ['message'],
      properties: { message: { type: 'string', description: 'Arbitrary string to sign.' } },
      additionalProperties: false,
    },
  },
  {
    name: 'mcp_call',
    description: `POST an MCP tool call to any remote MCP server over HTTP (JSON-RPC 2.0). Use when browsing, buying, or interacting with another agent's MCP endpoint — e.g. url='https://realrealgenuine.com/mcp', tool='list_drops', arguments={brand_slug:'clooudie'}.`,
    inputSchema: {
      type: 'object',
      required: ['url', 'tool'],
      properties: {
        url:        { type: 'string', description: 'Target MCP endpoint URL.' },
        tool:       { type: 'string', description: 'Tool name to invoke on that server.' },
        arguments:  { type: 'object', description: 'Arguments object for the tool.', additionalProperties: true },
        timeout_ms: { type: 'number', description: 'Optional request timeout in ms. Default 30000.' },
      },
      additionalProperties: false,
    },
  },
];

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const name = req.params.name;
  const args = req.params.arguments ?? {};
  try {
    switch (name) {
      case 'get_wallet': {
        const [ethBal, usdcBal] = await Promise.all([
          provider.getBalance(wallet.address),
          usdc.balanceOf(wallet.address),
        ]);
        const payload = {
          label:     AGENT_LABEL,
          address:   wallet.address,
          chain:     'base-mainnet',
          chain_id:  CHAIN_ID,
          eth:       ethers.formatEther(ethBal),
          usdc:      ethers.formatUnits(usdcBal, 6),
          rpc:       RPC_URL,
          usdc_contract: USDC_ADDRESS,
        };
        return { content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }] };
      }
      case 'send_usdc': {
        if (!ethers.isAddress(args.to)) throw new Error(`invalid 'to' address: ${args.to}`);
        const amount = toUsdcBase(args.amount_usd);
        const tx = await usdc.transfer(args.to, amount);
        const receipt = await tx.wait(1);
        const payload = {
          success:    true,
          from:       wallet.address,
          to:         args.to,
          amount_usd: String(args.amount_usd),
          tx_hash:    receipt.hash,
          block:      receipt.blockNumber,
          basescan:   `https://basescan.org/tx/${receipt.hash}`,
        };
        return { content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }] };
      }
      case 'sign_message': {
        if (typeof args.message !== 'string') throw new Error('message must be a string');
        const sig = await wallet.signMessage(args.message);
        return { content: [{ type: 'text', text: JSON.stringify({ address: wallet.address, message: args.message, signature: sig }, null, 2) }] };
      }
      case 'mcp_call': {
        if (typeof args.url !== 'string' || !/^https?:\/\//.test(args.url)) throw new Error('url must be an http(s) URL');
        if (typeof args.tool !== 'string' || !args.tool) throw new Error('tool must be a non-empty string');
        const result = await sendMcpCall(args);
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      }
      default:
        throw new Error(`unknown tool: ${name}`);
    }
  } catch (err) {
    return {
      isError: true,
      content: [{ type: 'text', text: `Error in ${name}: ${err?.message ?? String(err)}` }],
    };
  }
});

await server.connect(new StdioServerTransport());
console.error(`[agent-wallet-mcp] ready. label="${AGENT_LABEL}" address=${wallet.address} chain_id=${CHAIN_ID}`);
