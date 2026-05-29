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
  'function nonces(address owner) view returns (uint256)',
  'function name() view returns (string)',
  'function version() view returns (string)',
];
const usdc = new ethers.Contract(USDC_ADDRESS, USDC_ABI, wallet);

// EIP-2612 permit typed-data (matches VIA lib/app/x402-server.ts verifier).
const PERMIT_TYPES = {
  Permit: [
    { name: 'owner',    type: 'address' },
    { name: 'spender',  type: 'address' },
    { name: 'value',    type: 'uint256' },
    { name: 'nonce',    type: 'uint256' },
    { name: 'deadline', type: 'uint256' },
  ],
};

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

async function postJsonRpc(url, method, params, timeout_ms = 30000) {
  const body = {
    jsonrpc: '2.0',
    id: Math.floor(Math.random() * 1_000_000),
    method,
    params: params ?? {},
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

async function sendMcpCall({ url, tool, arguments: args, timeout_ms = 30000 }) {
  return postJsonRpc(url, 'tools/call', { name: tool, arguments: args ?? {} }, timeout_ms);
}

async function listRemoteTools({ url, timeout_ms = 30000 }) {
  return postJsonRpc(url, 'tools/list', {}, timeout_ms);
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
    description: `Send USDC on Base mainnet via a plain ERC-20 transfer from this agent's wallet to a recipient address. Returns the on-chain transaction hash once confirmed. NOTE: paying a VIA seller is a TWO-step flow — a bare transfer alone does NOT complete the order. To buy, either use pay_x402_purchase (permit path), or use settle_by_transfer (which does the transfer AND posts the tx hash to the settle endpoint for you). Use send_usdc directly only for plain peer transfers with no order to settle.`,
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
    name: 'pay_x402_purchase',
    description: `Settle a VIA / x402 "exact" purchase the correct (sign-not-send) way. Call this with the fields from a seller buy_product response. It signs an EIP-2612 USDC permit authorising payTo to pull the amount, then POSTs { order_ref, x_payment } to the settle endpoint, which executes the permit on-chain (a single charge) and fires the mint + seller payout. Returns the settlement response. Use this whenever buy_product returns an x402_payment_required block — never a raw send_usdc transfer.`,
    inputSchema: {
      type: 'object',
      required: ['settle_endpoint', 'order_ref', 'pay_to', 'amount_units'],
      properties: {
        settle_endpoint: { type: 'string', description: 'Absolute URL of the settlement endpoint, e.g. https://app.getvia.xyz/api/x402/purchase (from buy_product .next.settle_endpoint).' },
        order_ref:       { type: 'string', description: 'The order_ref returned by buy_product, e.g. VIA-2605-537DJB.' },
        pay_to:          { type: 'string', description: 'payTo address from x402_payment_required.payTo (the permit spender).' },
        amount_units:    { type: ['string', 'number'], description: 'maxAmountRequired from x402_payment_required, in USDC base units (6dp, e.g. "100000" = 0.10 USDC).' },
        network:         { type: 'string', description: 'Optional. Default eip155:8453 (Base mainnet).' },
        asset:           { type: 'string', description: 'Optional USDC contract address. Defaults to the configured USDC_ADDRESS.' },
        token_name:      { type: 'string', description: 'Optional EIP-712 domain name from x402_payment_required.extra.name. Default reads USDC.name().' },
        token_version:   { type: 'string', description: 'Optional EIP-712 domain version from x402_payment_required.extra.version. Default reads USDC.version().' },
        timeout_ms:      { type: 'number', description: 'Optional settle request timeout in ms. Default 60000.' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'settle_by_transfer',
    description: `Settle a VIA purchase the raw-transfer way (send-not-sign), end to end. Use this when the buyer_wallet cannot sign an EIP-2612 permit, or as a fallback to pay_x402_purchase. It (1) sends a USDC transfer of amount_usd to pay_to from this agent's wallet, then (2) POSTs { order_ref, payment_tx_hash } to the settle endpoint, which verifies the on-chain transfer and fires mint + payout. amount_usd must be >= the order total (maxAmountRequired / 1e6) and the transfer originates from this wallet (must equal the order's buyer_wallet). Returns the transfer tx hash and the settlement response.`,
    inputSchema: {
      type: 'object',
      required: ['settle_endpoint', 'order_ref', 'pay_to', 'amount_usd'],
      properties: {
        settle_endpoint: { type: 'string', description: 'Absolute URL from buy_product .next.settle_endpoint, e.g. https://app.getvia.xyz/api/x402/purchase.' },
        order_ref:       { type: 'string', description: 'The order_ref returned by buy_product.' },
        pay_to:          { type: 'string', description: 'payTo address from x402_payment_required.payTo.' },
        amount_usd:      { type: ['number', 'string'], description: 'Amount in USD (1:1 USDC) to transfer; must be >= the order total.' },
        timeout_ms:      { type: 'number', description: 'Optional settle request timeout in ms. Default 60000.' },
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
    description: `POST an MCP tool call to any remote MCP server over HTTP (JSON-RPC 2.0). Use when browsing, buying, or interacting with another agent's MCP endpoint — e.g. url='https://realrealgenuine.com/mcp', tool='list_drops', arguments={brand_slug:'clooudie'}. BEFORE calling a tool you don't know exists on the remote, call list_remote_tools first to enumerate what's available.`,
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
  {
    name: 'list_remote_tools',
    description: `Enumerate every tool exposed by a remote MCP server over HTTP. Returns the full tools/list response — each tool's name, description, and input schema. Use this as your FIRST move when exploring a new MCP endpoint (e.g. https://realrealgenuine.com/mcp) — do not assume a tool doesn't exist based on other surfaces like landing pages or search engines.`,
    inputSchema: {
      type: 'object',
      required: ['url'],
      properties: {
        url:        { type: 'string', description: 'Target MCP endpoint URL (e.g. https://realrealgenuine.com/mcp).' },
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
      case 'pay_x402_purchase': {
        if (typeof args.settle_endpoint !== 'string' || !/^https?:\/\//.test(args.settle_endpoint)) throw new Error('settle_endpoint must be an http(s) URL');
        if (typeof args.order_ref !== 'string' || !args.order_ref) throw new Error('order_ref must be a non-empty string');
        if (!ethers.isAddress(args.pay_to)) throw new Error(`invalid pay_to address: ${args.pay_to}`);
        const value = BigInt(String(args.amount_units));
        if (value <= 0n) throw new Error('amount_units must be a positive integer (USDC base units)');

        const assetAddr = (typeof args.asset === 'string' && ethers.isAddress(args.asset)) ? args.asset : USDC_ADDRESS;
        const permitUsdc = new ethers.Contract(assetAddr, USDC_ABI, provider);

        // Resolve nonce + EIP-712 domain (name/version) from the token unless overridden.
        const [nonce, tokenName, tokenVersion] = await Promise.all([
          permitUsdc.nonces(wallet.address),
          (typeof args.token_name === 'string' && args.token_name) ? Promise.resolve(args.token_name) : permitUsdc.name(),
          (typeof args.token_version === 'string' && args.token_version) ? Promise.resolve(args.token_version) : permitUsdc.version(),
        ]);

        const deadline = BigInt(Math.floor(Date.now() / 1000) + 300); // 5 min
        const domain = { name: tokenName, version: tokenVersion, chainId: CHAIN_ID, verifyingContract: assetAddr };
        const permitValue = { owner: wallet.address, spender: args.pay_to, value, nonce, deadline };
        const signature = await wallet.signTypedData(domain, PERMIT_TYPES, permitValue);

        const paymentPayload = {
          scheme:  'exact',
          network: typeof args.network === 'string' && args.network ? args.network : `eip155:${CHAIN_ID}`,
          payload: {
            signature,
            authorization: {
              from:        wallet.address,
              to:          args.pay_to,
              value:       value.toString(),
              validAfter:  '0',
              validBefore: deadline.toString(),
              nonce:       nonce.toString(),
            },
          },
        };
        const xPayment = Buffer.from(JSON.stringify(paymentPayload)).toString('base64');

        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), typeof args.timeout_ms === 'number' ? args.timeout_ms : 60000);
        let settleResp;
        try {
          const res = await fetch(args.settle_endpoint, {
            method:  'POST',
            headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
            body:    JSON.stringify({ order_ref: args.order_ref, x_payment: xPayment }),
            signal:  controller.signal,
          });
          const text = await res.text();
          let json; try { json = JSON.parse(text); } catch { json = { raw: text }; }
          settleResp = { httpStatus: res.status, ...json };
        } finally {
          clearTimeout(timer);
        }

        const payload = {
          order_ref:   args.order_ref,
          from:        wallet.address,
          pay_to:      args.pay_to,
          amount_usdc: (Number(value) / 1e6).toString(),
          settlement:  settleResp,
        };
        return { content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }] };
      }
      case 'settle_by_transfer': {
        if (typeof args.settle_endpoint !== 'string' || !/^https?:\/\//.test(args.settle_endpoint)) throw new Error('settle_endpoint must be an http(s) URL');
        if (typeof args.order_ref !== 'string' || !args.order_ref) throw new Error('order_ref must be a non-empty string');
        if (!ethers.isAddress(args.pay_to)) throw new Error(`invalid pay_to address: ${args.pay_to}`);
        const amount = toUsdcBase(args.amount_usd);

        // 1. Send the USDC transfer.
        const tx = await usdc.transfer(args.pay_to, amount);
        const receipt = await tx.wait(1);

        // 2. Hand the tx hash to the settle endpoint.
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), typeof args.timeout_ms === 'number' ? args.timeout_ms : 60000);
        let settleResp;
        try {
          const res = await fetch(args.settle_endpoint, {
            method:  'POST',
            headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
            body:    JSON.stringify({ order_ref: args.order_ref, payment_tx_hash: receipt.hash }),
            signal:  controller.signal,
          });
          const text = await res.text();
          let json; try { json = JSON.parse(text); } catch { json = { raw: text }; }
          settleResp = { httpStatus: res.status, ...json };
        } finally {
          clearTimeout(timer);
        }

        const payload = {
          order_ref:       args.order_ref,
          from:            wallet.address,
          pay_to:          args.pay_to,
          amount_usd:      String(args.amount_usd),
          payment_tx_hash: receipt.hash,
          basescan:        `https://basescan.org/tx/${receipt.hash}`,
          settlement:      settleResp,
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
      case 'list_remote_tools': {
        if (typeof args.url !== 'string' || !/^https?:\/\//.test(args.url)) throw new Error('url must be an http(s) URL');
        const result = await listRemoteTools(args);
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
