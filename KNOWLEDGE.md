# RRG — System Knowledge Base

> **Canonical reference for DrHobbs MCP server, AI agents, and developers.**
> Version: 2026-03-31 | Maintained in GitHub → also served from richard-hobbs.com VPS.

---

## 1. What is RRG?

**RRG (Real Real Genuine)** is a co-creation platform hosted at **realrealgenuine.com/rrg**.

- Creators submit original digital artwork (JPEG + optional source files)
- The platform operator (richard-hobbs.com) curates and approves submissions
- Each approved work becomes an **ERC-1155 NFT drop** on Base
- Buyers (human or AI agent) purchase with **USDC** and receive:
  - An ERC-1155 token on Base (permanent on-chain proof of ownership)
  - A high-resolution JPEG download
  - Any additional source files submitted by the creator
- **70% of each sale** goes to the creator; 30% to the platform

RRG is designed for both human buyers and autonomous AI agents. The purchase flow is gasless from the buyer's perspective — the platform covers gas for minting.

---

## 2. DrHobbs — Agent Identity

**DrHobbs** is the AI agent that represents richard-hobbs.com across agentic commerce networks.

| Property | Value |
|---|---|
| Agent name | DrHobbs |
| Home | richard-hobbs.com |
| MCP endpoint | https://richard-hobbs.com/mcp |
| Agent wallet | `0xe653804032A2d51Cc031795afC601B9b1fd2c375` |
| Network | Base (mainnet) |
| ERC-8004 status | Registered |
| Connected platforms | OpenClaw, Telegram bot, desktop interface |

### ERC-8004 Trust Registration

DrHobbs is registered under **ERC-8004: Trustless Agents** (live on Ethereum mainnet since 29 Jan 2026). ERC-8004 provides three on-chain trust layers:

1. **Identity Registry** (ERC-721)
   - DrHobbs holds an ERC-721 identity token
   - The `tokenURI` resolves to a JSON registration file listing:
     endpoints, capabilities, supported protocols, and `agentWallet`
   - Any agent querying the registry can discover DrHobbs, connect, and pay it directly
   - Supports MCP, A2A, ENS, DID protocols

2. **Reputation Registry**
   - Records client feedback (ratings + tags) after completed transactions
   - Every successful RRG purchase posts a reputation signal
   - Aggregated trust score visible to prospective buyer agents

3. **Validation Registry**
   - Hooks for independent validators (TEE attestation, zkML proofs, stake-backed re-execution)
   - Used for high-value or high-trust transaction verification

**What this means in practice:** An AI agent that has never interacted with DrHobbs before can:
1. Look up DrHobbs in the ERC-8004 Identity Registry
2. Find the MCP endpoint and agent wallet
3. Check the Reputation Registry for trust signals
4. Proceed to purchase with confidence — no human introduction required

---

## 3. Infrastructure

| Component | Provider | URL / ID |
|---|---|---|
| Primary domain | Hetzner VPS (nginx, Ubuntu) | richard-hobbs.com |
| RRG Next.js app | Vercel | rrg-ruddy.vercel.app |
| Database | Supabase | sanvqnvvzdkjvfmxnxur.supabase.co |
| File storage | Supabase Storage (private) | bucket: `rrg-submissions` |
| NFT images (IPFS) | Pinata | ipfs.io / gateway.pinata.cloud |
| Email delivery | Resend | deliver@richard-hobbs.com |
| Smart contracts | Base mainnet | see §4 |

### Environment (Base mainnet)

| Variable | Value |
|---|---|
| Chain ID | 8453 |
| Network name | Base |
| RPC | https://mainnet.base.org |
| Block explorer | https://basescan.org |
| USDC contract | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` |
| RRG contract | `0x9f07621f73e7caaf2040c35833d5350f666b7177` |
| OpenSea | https://opensea.io/collection/rrg-real-real-genuine-318941776 |

---

## 4. Smart Contracts

### RRG.sol — ERC-1155 NFT Contract

Deployed on **Base mainnet**: `0x9f07621f73e7caaf2040c35833d5350f666b7177`

Key functions:

```solidity
// Register a drop (owner only)
function createDrop(uint256 tokenId, uint256 maxSupply, uint256 priceUsdc6dp) external

// Activate/deactivate a drop (owner only)
function setDropActive(uint256 tokenId, bool active) external

// Purchase — buyer signs EIP-2612 permit off-chain; server submits this
function mintWithPermit(
    uint256 tokenId,
    address buyer,
    uint256 deadline,
    uint8 v, bytes32 r, bytes32 s
) external

// Read drop state
function getDrop(uint256 tokenId) external view returns (
    uint256 maxSupply, uint256 minted, uint256 priceUsdc, bool active
)
```

**How minting works (permit flow):**
1. Server generates EIP-2612 typed-data payload — buyer signs off-chain (no gas)
2. Buyer's signature authorises the RRG contract to pull exact USDC from their wallet
3. Server submits `mintWithPermit` — contract executes `USDC.permit()` + `transferFrom()` + `mint()` atomically
4. Platform wallet pays gas; buyer pays zero ETH

---

## 5. MCP Server

DrHobbs exposes an MCP (Model Context Protocol) server at:

```
POST https://richard-hobbs.com/mcp
```

**Transport:** Streamable HTTP (stateless — safe for serverless/Vercel)
**Protocol:** MCP 2025-11-25

### Connecting

Add to your MCP client config (e.g. Claude Desktop `claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "drhobbs": {
      "url": "https://richard-hobbs.com/mcp"
    }
  }
}
```

Or for any MCP-compatible client using the SDK:

```typescript
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const client = new Client({ name: 'my-agent', version: '1.0.0' });
await client.connect(new StreamableHTTPClientTransport(new URL('https://richard-hobbs.com/mcp')));
```

### Tools

| Tool | Description |
|---|---|
| `list_drops` | List all active NFT drops with price, edition size, and remaining supply |
| `get_current_brief` | Get the current design brief / creative challenge |
| `submit_design` | Submit a JPEG artwork for review (agent submission path) |
| `initiate_purchase` | Start a permit-based purchase — returns EIP-712 payload to sign |
| `confirm_purchase` | Submit signed permit — mints NFT and returns download link |
| `get_download_links` | Retrieve signed download URLs for a previous purchase by wallet + tokenId |

### submit_design parameters

| Parameter | Required | Description |
|---|---|---|
| `title` | ✅ | Artwork title (max 60 chars) |
| `image_url` | ✅ | Publicly accessible JPEG URL (max 5 MB) |
| `creator_wallet` | ✅ | Base 0x address — receives 70% of sales |
| `description` | optional | Max 280 chars |
| `creator_email` | optional | Notified on approval |
| `suggested_edition` | optional | e.g. `"10"` — reviewer can adjust |
| `suggested_price_usdc` | optional | e.g. `"15"` — reviewer can adjust |

---

## 6. API Reference

**Base URL (current):** `https://rrg-ruddy.vercel.app`
*(Will move to `https://richard-hobbs.com` when VPS deployment is complete)*

All endpoints return JSON. No authentication required for public reads. POST endpoints require `Content-Type: application/json`.

---

### 5.1 List active drops

```
GET /api/rrg/drops
```

**Response:**
```json
[
  {
    "tokenId": 1,
    "title": "Glam Puss",
    "description": "...",
    "priceUsdc": "1.00",
    "editionSize": 10,
    "minted": 2,
    "remaining": 8,
    "active": true,
    "ipfsUrl": "ipfs://..."
  }
]
```

---

### 5.2 Get single drop

```
GET /api/rrg/drops?tokenId=1
```

---

### 5.3 Initiate purchase (permit flow — for agents with EIP-712 signing)

```
POST /api/rrg/purchase
Body: { "tokenId": 1, "buyerWallet": "0x..." }
```

**Response:**
```json
{
  "permitPayload": {
    "domain": {
      "name": "USD Coin",
      "version": "2",
      "chainId": 8453,
      "verifyingContract": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"
    },
    "types": {
      "Permit": [
        { "name": "owner",    "type": "address" },
        { "name": "spender",  "type": "address" },
        { "name": "value",    "type": "uint256" },
        { "name": "nonce",    "type": "uint256" },
        { "name": "deadline", "type": "uint256" }
      ]
    },
    "value": {
      "owner":    "0x<buyerWallet>",
      "spender":  "0x9f07621f73e7caaf2040c35833d5350f666b7177",
      "value":    "1000000",
      "nonce":    "0",
      "deadline": "1234567890"
    }
  }
}
```

---

### 5.4 Confirm purchase (permit flow)

After signing `permitPayload` with `wallet.signTypedData(domain, types, value)`:

```
POST /api/rrg/confirm
Body:
{
  "tokenId":     1,
  "buyerWallet": "0x...",
  "buyerEmail":  "agent@example.com",
  "deadline":    "1234567890",
  "signature":   "0x..."
}
```

**Response:**
```json
{
  "success": true,
  "txHash": "0x...",
  "downloadUrl": "https://rrg-ruddy.vercel.app/rrg/download?token=...",
  "downloadToken": "..."
}
```

---

### 5.5 Access purchased files

**Option A — download page (browser):**
```
GET /rrg/download?token=<downloadToken>
```
Renders a page with download buttons. Token valid 24 hours, refreshed on each visit.

**Option B — wallet-based lookup (agents, no token needed):**
```
GET /api/rrg/download?wallet=0x...&tokenId=1
```
Returns JSON with signed Supabase URLs (24-hour expiry).

**Option C — email delivery:**
```
POST /api/rrg/deliver
Body: { "txHash": "0x...", "email": "agent@example.com" }
```
Sends download link to email. Works any time after a confirmed purchase.

---

### 5.6 x402 payment flow *(in development)*

The x402 endpoint implements the HTTP 402 Payment Required standard for agent-native purchases. No EIP-712 signing required — the agent sends a direct USDC transfer.

```
GET /api/rrg/drop/[tokenId]/content
```

**Without payment:**
```
← 402 Payment Required
{
  "x402Version": 1,
  "accepts": [{
    "scheme":             "exact",
    "network":            "base",
    "maxAmountRequired":  "1000000",
    "resource":           "https://realrealgenuine.com/api/rrg/drop/1/content",
    "payTo":              "0xe653804032A2d51Cc031795afC601B9b1fd2c375",
    "asset":              "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    "description":        "Glam Puss — Token #1 — RRG",
    "mimeType":           "application/json"
  }]
}
```

**With X-PAYMENT header (valid USDC transfer proof):**
```
← 200
{
  "downloadToken": "...",
  "files": ["https://...signed-url..."]
}
```
ERC-1155 minting happens asynchronously in the background.

---

### 5.7 Wallet-to-wallet claim *(in development)*

For agents that send USDC directly to the DrHobbs wallet without x402:

```
POST /api/rrg/claim
Body:
{
  "txHash":      "0x...",
  "buyerWallet": "0x...",
  "tokenId":     1,
  "email":       "agent@example.com"
}
```

Server verifies on-chain:
- Transaction is a USDC transfer on the correct chain
- `to` is the platform wallet `0xe653804032A2d51Cc031795afC601B9b1fd2c375`
- Amount equals the drop price exactly
- Tx is confirmed (≥ 1 block)

**Response:**
```json
{ "success": true, "status": "minting", "jobId": "..." }
```

Files delivered asynchronously once mint is confirmed.

---

## 6. Agent Purchase — Step by Step

### Permit flow (current, works now)

For agents with ethers.js / viem available:

```javascript
const { ethers } = require('ethers');

// 1. List drops
const drops = await fetch('https://rrg-ruddy.vercel.app/api/rrg/drops').then(r => r.json());
const drop = drops.find(d => d.tokenId === 1);

// 2. Get permit payload
const { permitPayload } = await fetch('https://rrg-ruddy.vercel.app/api/rrg/purchase', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ tokenId: 1, buyerWallet: wallet.address }),
}).then(r => r.json());

// 3. Sign permit (gasless — no ETH needed)
const signature = await wallet.signTypedData(
  permitPayload.domain,
  permitPayload.types,
  permitPayload.value
);

// 4. Confirm — triggers mint + delivery
const result = await fetch('https://rrg-ruddy.vercel.app/api/rrg/confirm', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    tokenId:     1,
    buyerWallet: wallet.address,
    buyerEmail:  'agent@example.com',
    deadline:    permitPayload.value.deadline,
    signature,
  }),
}).then(r => r.json());

// 5. Download files
const files = await fetch(
  `https://rrg-ruddy.vercel.app/api/rrg/download?wallet=${wallet.address}&tokenId=1`
).then(r => r.json());
```

**Requirements:**
- Wallet with USDC on Base mainnet
- No ETH required — purchase is fully gasless
- Permit expires in 10 minutes — complete steps 2–4 without delay
- USDC amount must exactly match drop price

### x402 flow (coming — simpler for agents)

No signing required — agent sends USDC directly to DrHobbs wallet:

1. `GET /api/rrg/drop/1/content` → receive 402 with `payTo` and `maxAmountRequired`
2. Send USDC transfer on-chain to `payTo`
3. `GET /api/rrg/drop/1/content` with `X-PAYMENT: <proof>` header
4. Receive file URLs in response; NFT minted in background

---

## 7. Data Model

### rrg_submissions
| Column | Type | Notes |
|---|---|---|
| id | uuid | PK |
| title | text | Artwork title |
| description | text | |
| creator_wallet | text | EVM address |
| status | text | pending / approved / rejected |
| jpeg_storage_path | text | Supabase Storage path |
| additional_files_path | text | Supabase Storage path (nullable) |
| token_id | int | Set on approval |
| edition_size | int | Max supply |
| price_usdc | text | e.g. "1.00" |
| ipfs_cid | text | Set after first purchase (Pinata) |
| ipfs_url | text | IPFS gateway URL |

### app_purchases
| Column | Type | Notes |
|---|---|---|
| id | uuid | PK |
| submission_id | uuid | FK → rrg_submissions |
| token_id | int | ERC-1155 token ID |
| buyer_wallet | text | EVM address |
| buyer_type | text | human / agent |
| tx_hash | text | On-chain tx |
| amount_usdc | text | Paid amount |
| download_token | text | 64-char hex, 24h expiry |
| files_delivered | bool | |

---

## 8. File Delivery

All purchased files are stored in **Supabase Storage** (private bucket `rrg-submissions`).

- Files are never public — access only via time-limited signed URLs (24-hour)
- Original high-res JPEG is always included
- Additional source files (if submitted by creator) also included
- After first successful purchase of a token, a resized JPEG (max 800px) is uploaded to IPFS via Pinata for the ERC-1155 `tokenURI` metadata

File paths:
```
submissions/{submissionId}/jpeg/{filename}.jpg
submissions/{submissionId}/additional/{filename}
```

---

## 9. Email Notifications

Sent via **Resend** from `deliver@richard-hobbs.com`:

| Trigger | Recipient | Content |
|---|---|---|
| Successful purchase | Buyer | Download link, tx hash, drop details |
| POST /api/rrg/deliver | Any email | Re-send download link (agent use) |

---

## 10. Admin

Admin panel at `/rrg/admin` (password protected via `ADMIN_SECRET`).

Functions:
- View pending submissions
- Approve submissions (assigns token ID, activates drop)
- Reject submissions (with reason)
- View all purchases

---

## 11. Roadmap

| Feature | Status |
|---|---|
| ERC-1155 permit-based purchase | ✅ Live (Base mainnet) |
| Human purchase UI | ✅ Live |
| File delivery (Supabase + email) | ✅ Live |
| IPFS metadata via Pinata | ✅ Live |
| x402 agent payment endpoint | 🔧 Building |
| Wallet-to-wallet claim + async mint | 🔧 Building |
| DrHobbs MCP tools for RRG | ✅ Live (at /mcp) |
| ERC-8004 reputation signals on purchase | ✅ Live |
| Base mainnet deploy | ✅ Live |

---

## 12. Key Addresses (Public)

| Label | Address | Network |
|---|---|---|
| Platform / DrHobbs wallet | `0xe653804032A2d51Cc031795afC601B9b1fd2c375` | Base mainnet |
| RRG contract | `0x9f07621f73e7caaf2040c35833d5350f666b7177` | Base mainnet |
| USDC | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` | Base mainnet |

---

*This document is the single source of truth for the RRG platform and DrHobbs agent integration.
For updates: edit in GitHub (richardjhobbs/rrg) and redeploy to VPS.*
