# RRG — System Knowledge Base

> **Canonical reference for DrHobbs MCP server, AI agents, and developers.**
> Version: 2026-03-09 | Maintained in GitHub → also served from richard-hobbs.com VPS.

---

## 1. What is RRG?

**RRG (Real Real Genuine)** is a co-creation platform hosted at **realrealgenuine.com/rrg**.

- Creators submit original digital artwork (JPEG or PNG + optional source files)
- The platform operator (richard-hobbs.com) curates and approves submissions
- Each approved work becomes an **ERC-1155 NFT drop** on Base mainnet
- Buyers (human or AI agent) purchase with **USDC** and receive:
  - An ERC-1155 token on Base mainnet (permanent on-chain proof of ownership)
  - A high-resolution image download
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
| Network | Base mainnet (chain ID 8453) |
| ERC-8004 status | Registered (Agent ID: 17666) |
| Connected platforms | OpenClaw, Telegram bot, desktop interface |

### ERC-8004 Trust Registration

DrHobbs is registered under **ERC-8004: Trustless Agents** (live on Ethereum mainnet since 29 Jan 2026). ERC-8004 provides three on-chain trust layers:

1. **Identity Registry** (ERC-721)
   - DrHobbs holds an ERC-721 identity token (ID: 17666)
   - The `tokenURI` resolves to a JSON registration file listing:
     endpoints, capabilities, supported protocols, and `wallet`
   - Any agent querying the registry can discover DrHobbs, connect, and pay it directly
   - Supports MCP, A2A, ENS, DID protocols

2. **Reputation Registry**
   - Records client feedback (ratings + tags) after completed transactions
   - Every successful RRG purchase posts a reputation signal automatically
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
| RRG Next.js app | PM2 on VPS (port 3001) + Vercel | realrealgenuine.com/rrg |
| Database | Supabase | sanvqnvvzdkjvfmxnxur.supabase.co |
| File storage | Supabase Storage (private) | bucket: `rrg-submissions` |
| NFT images (IPFS) | Pinata | ipfs.io / gateway.pinata.cloud |
| Email delivery | Resend | deliver@richard-hobbs.com |
| Smart contracts | Base mainnet | see §4 |

### Environment

| Variable | Value |
|---|---|
| Chain ID | 8453 |
| Network name | Base mainnet |
| RPC | https://mainnet.base.org |
| Block explorer | https://basescan.org |
| USDC contract | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` |
| RRG contract | `0x9F07621f73E7CAaF2040C35833D5350F666b7177` |

---

## 4. Smart Contracts

### RRG.sol — ERC-1155 NFT Contract

Deployed on **Base mainnet**: `0x9F07621f73E7CAaF2040C35833D5350F666b7177`
Verified on Basescan: https://basescan.org/address/0x9F07621f73E7CAaF2040C35833D5350F666b7177#code

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

// Operator mint — owner-only, for direct USDC transfer purchases (agent claims)
function operatorMint(uint256 tokenId, address buyer) external

// Read drop state
function getDrop(uint256 tokenId) external view returns (
    uint256 maxSupply, uint256 minted, uint256 priceUsdc, bool active
)

// ERC-7572 collection metadata
function contractURI() external view returns (string)
```

**How minting works:**

**Permit flow (human buyers via browser):**
1. Server generates EIP-2612 typed-data payload — buyer signs off-chain (no gas)
2. Buyer's signature authorises the RRG contract to pull exact USDC from their wallet
3. Server submits `mintWithPermit` — contract executes `USDC.permit()` + `transferFrom()` + `mint()` atomically
4. Platform wallet pays gas; buyer pays zero ETH

**Claim flow (agent buyers via API):**
1. Agent sends USDC directly to platform wallet on Base mainnet
2. Agent calls `/api/rrg/claim` with tx hash, buyer wallet, and token ID
3. Server verifies on-chain USDC transfer, then calls `operatorMint` to mint NFT to buyer
4. ERC-8004 reputation signal posted automatically

---

## 5. API Reference

**Base URL:** `https://richard-hobbs.com`

All endpoints return JSON. No authentication required for public reads. POST endpoints require `Content-Type: application/json`.

---

### 5.1 List active drops

```
GET /api/rrg/drops
```

**Response:**
```json
{
  "currentBrief": {
    "id": "uuid",
    "title": "Brief Title",
    "description": "Brief description...",
    "ends_at": "2026-03-15T23:59:59Z"
  },
  "drops": [
    {
      "token_id": 1,
      "title": "Glam Puss",
      "description": "...",
      "price_usdc": "1.00",
      "edition_size": 10,
      "onChain": {
        "minted": 2,
        "maxSupply": 10,
        "active": true,
        "soldOut": false
      }
    }
  ]
}
```

---

### 5.2 Initiate purchase (permit flow — for browser / agents with EIP-712 signing)

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
    "types": { "Permit": [...] },
    "value": {
      "owner": "0x<buyerWallet>",
      "spender": "0x9F07621f73E7CAaF2040C35833D5350F666b7177",
      "value": "1000000",
      "nonce": "0",
      "deadline": "1234567890"
    }
  }
}
```

---

### 5.3 Confirm purchase (permit flow)

After signing `permitPayload`:

```
POST /api/rrg/confirm
Body: {
  "tokenId": 1,
  "buyerWallet": "0x...",
  "buyerEmail": "agent@example.com",
  "deadline": "1234567890",
  "signature": "0x..."
}
```

**Response:**
```json
{
  "success": true,
  "txHash": "0x...",
  "downloadUrl": "https://realrealgenuine.com/rrg/download?token=...",
  "downloadToken": "..."
}
```

---

### 5.4 Claim purchase (wallet-to-wallet — for agents sending USDC directly)

For agents that send USDC directly to the platform wallet:

```
POST /api/rrg/claim
Body: {
  "txHash": "0x...",
  "buyerWallet": "0x...",
  "tokenId": 1,
  "email": "agent@example.com"
}
```

Server verifies on-chain:
- Transaction is a USDC transfer on Base mainnet
- `to` is the platform wallet `0xe653804032A2d51Cc031795afC601B9b1fd2c375`
- Amount equals the drop price exactly
- Tx is confirmed (>= 1 block)
- Not previously claimed

**Response:**
```json
{
  "success": true,
  "txHash": "0x...",
  "downloadUrl": "https://realrealgenuine.com/rrg/download?token=...",
  "status": "minted"
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

## 6. Agent Purchase — Step by Step

### Claim flow (recommended for agents)

The simplest agent purchase flow — no EIP-712 signing required:

```
1. GET /api/rrg/drops → find the drop, note token_id and price_usdc
2. Send exact USDC amount to 0xe653804032A2d51Cc031795afC601B9b1fd2c375 on Base mainnet
3. POST /api/rrg/claim with { txHash, buyerWallet, tokenId }
4. Receive downloadUrl in response — NFT minted to your wallet
```

### Permit flow (gasless — for agents with EIP-712 signing)

```javascript
const { ethers } = require('ethers');

// 1. List drops
const data = await fetch('https://richard-hobbs.com/api/rrg/drops').then(r => r.json());
const drop = data.drops.find(d => d.token_id === 1);

// 2. Get permit payload
const { permitPayload } = await fetch('https://richard-hobbs.com/api/rrg/purchase', {
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
const result = await fetch('https://richard-hobbs.com/api/rrg/confirm', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    tokenId: 1,
    buyerWallet: wallet.address,
    buyerEmail: 'agent@example.com',
    deadline: permitPayload.value.deadline,
    signature,
  }),
}).then(r => r.json());

// 5. Download files
const files = await fetch(
  `https://richard-hobbs.com/api/rrg/download?wallet=${wallet.address}&tokenId=1`
).then(r => r.json());
```

**Requirements:**
- Wallet with USDC on Base mainnet
- No ETH required — purchase is fully gasless
- Permit expires in 10 minutes — complete steps 2–4 without delay
- USDC amount must exactly match drop price

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
| ipfs_cid | text | ERC-1155 metadata JSON CID |
| ipfs_image_cid | text | JPEG/PNG image CID |
| network | text | 'base' |
| brief_id | uuid | FK → rrg_briefs (nullable) |

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
| network | text | 'base' |

---

## 8. File Delivery

All purchased files are stored in **Supabase Storage** (private bucket `rrg-submissions`).

- Files are never public — access only via time-limited signed URLs (24-hour)
- Original high-res image is always included (JPEG or PNG)
- Additional source files (if submitted by creator) also included
- On first purchase, the image is uploaded to IPFS via Pinata for the ERC-1155 `tokenURI` metadata

File paths:
```
submissions/{submissionId}/jpeg/{filename}
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

Admin panel at `/admin` (password protected via `ADMIN_SECRET`).

Functions:
- View pending submissions
- Approve submissions (assigns token ID, registers drop on-chain, activates)
- Reject submissions (with reason)
- View all purchases

---

## 11. Status

| Feature | Status |
|---|---|
| ERC-1155 permit-based purchase | ✅ Live (Base mainnet) |
| ERC-1155 operatorMint (agent claim) | ✅ Live (Base mainnet) |
| Human purchase UI | ✅ Live |
| File delivery (Supabase + email) | ✅ Live |
| IPFS metadata via Pinata | ✅ Live |
| ERC-8004 reputation signals on purchase | ✅ Live |
| DrHobbs MCP tools for RRG | ✅ Live |
| Wallet-to-wallet claim + operatorMint | ✅ Live |
| VPS deployment (nginx + PM2) | ✅ Live |
| Base mainnet deploy | ✅ Live |
| ERC-7572 contractURI | ✅ Live |
| Contract verified on Basescan | ✅ Live |
| Autopost to Telegram + BlueSky | ✅ Live |

---

## 12. Key Addresses (Public)

| Label | Address | Network |
|---|---|---|
| Platform / DrHobbs wallet | `0xe653804032A2d51Cc031795afC601B9b1fd2c375` | Base mainnet |
| Operator / deployer wallet | `0x369d04F08F245454926AC96a0164a634fd94660B` | Base mainnet |
| RRG contract | `0x9F07621f73E7CAaF2040C35833D5350F666b7177` | Base mainnet |
| USDC | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` | Base mainnet |
| Identity Registry (ERC-8004) | `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432` | Base mainnet |
| Reputation Registry (ERC-8004) | `0x8004BAa17C55a88189AE136b182e5fdA19dE9b63` | Base mainnet |

---

*This document is the single source of truth for the RRG platform and DrHobbs agent integration.
For updates: edit in GitHub (richardjhobbs/rrg) and redeploy to VPS.*
