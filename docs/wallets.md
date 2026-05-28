# Wallet Register

Source of truth for accounting. All addresses are on Base mainnet (chain ID 8453) unless otherwise stated. Values pulled from Supabase (`app_sellers`, `rrg_submissions`) on 2026-05-09 and from canonical memory files (`wallet_separation.md`, `via_labs_structure.md`).

This file is the input for Agent Colin (admin) to build a chart of accounts and bookkeeping ledger. When a wallet is added, removed, or handed off to a brand owner, update this file and Colin's snapshot job.

## 1. Core operating wallets

These are the wallets that get topped up for operations. Treat as company-controlled.

| Role | ERC-8004 ID | Address | Notes |
|------|------|---------|-------|
| RRG / PLATFORM_WALLET | 33313 | `0xbfd71eA27FFc99747dA2873372f84346d9A8b7ed` | Platform agent. Receives on-chain 70% (or 97.5% for brand-owned drops) at sale. All RRG outreach, x402 receipts, marketing-oracle disbursements. Also the wallet referenced by `process.env.NEXT_PUBLIC_PLATFORM_WALLET` runtime fallback in `lib/app/splits.ts`, `lib/app/sendUsdc.ts`, `lib/app/mpp.ts`. |
| DEPLOYER | 26244 | `0x369d04f08f245454926ac96a0164a634fd94660b` | Gas-only signer. Pays gas for `operatorMint` and ERC-8004 `submitFeedback`. Should hold ETH on Base only, no USDC. Cost centre. |
| VIA Team Wallet | (owns #38538) | `0x58554E8423EF5C10be6fFC82EfABA9149f64de3d` | VIA Labs corporate. Owns staff and company NFTs. Owner of VIA Labs agent #38538 (getvia.xyz). x402 corporate wallet. Also the on-chain creator of two Digital Fashion Week tokens (42, 43). |
| DrHobbs (personal) | 17666 | `0xe653804032A2d51Cc031795afC601B9b1fd2c375` | Richard's personal agent. Knowledge marketplace, x402, fashion-tech experiments. NOT used for RRG platform flows. Also flagged as a personal-pre-handoff wallet (see section 2) and historic on-chain creator of several test tokens. |

## 2. Personal wallets used as brand placeholders before handoff

Owned by Richard. Used as the brand `wallet_address` while a brand is in pre-handoff state. Once the brand owner accepts terms and provides their wallet, these get swapped out.

| Address | Currently bound to | DB status | Notes |
|---------|--------------------|-----------|-------|
| `0x61e01997e6a0C692656e94955c67CB3ebcAb8f19` | East Coast Cassettes (`eastcoast`) | suspended / live onboarding | Also on-chain creator for tokens 28-33 (3 tokens). |
| `0xc12Ecf02448e0E56DAd9C0D5473553b80d030D75` | Digital Fashion Week (`dfw`) | suspended | Heavy historical use as on-chain creator: RRG tokens 4-26 (11 tokens), East Coast Cassettes token 34, Artemist token 39. |
| `0xdB59CD2c8F9c6e576510bf7ED294654f41241B65` | Not currently bound to any brand in DB | n/a | Personal wallet, not yet attached to a brand record. Top-ups recorded as personal, not platform. |
| `0xe653804032A2d51Cc031795afC601B9b1fd2c375` | RRG (`rrg`, suspended), Test Brand (`test-brand`, abandoned) | suspended / abandoned | Same address as the DrHobbs agent in section 1. Historic on-chain creator for RRG tokens 5-38, Artemist 36, LIVVIUM 40-41, TYO 30, plus token 27 with no brand binding. |

## 3. Brand-owned wallets (handed off, brand controls funds)

Inbound USDC to these is the brand's cash. Platform sees only the 2.5% commission, paid via `lib/app/auto-payout.ts` before the brand transfer.

| Brand | Slug | Wallet | DB status | Token range | Token count |
|-------|------|--------|-----------|-------------|-------------|
| Artemist | `artemist` | `0x2c9a1dadd6cb5425bf0e677fada64a257a558438` | active / live | n/a (no creator-wallet match in submissions; tokens 36, 39, 44 created from other wallets) | n/a |
| Clooudie | `clooudie` | `0xca5c9c4da1787fea491ed6c94e86b04ec46be61d` | active / live | 516-530 | 15 |
| Frey Tailored | `frey-tailored` | `0x30b1e8cc377a75d9664c26415a820c4925afa595` | active / live | 531-573 | 38 |
| LIVVIUM | `livvium` | `0x019d94b9c90abd38f84ebbb488e6c833cdeffc57` | active / live | 218 | 1 |
| MYKLÉ | `mykle` | `0x9eb5405fef682e1d4d555f64a683a499076556a3` | suspended / in_progress | 189-212 | 24 |
| Nolo | `nolo` | `0x27daa49fb93445cdb6e3f3a6be7cd6bae1f04e2d` | active / in_progress | 571 (1) via brand wallet; 568-570 (3) via creator `0x891c13aa323378637404efd971553a3a6df5aaf1` | 4 across two creators |
| PassportADV | `passport-adv` | `0xb4febbe6c0a0cd350c76054ccfd037d8bf47e502` | active / in_progress | 93-103 (creator was the holding wallet) | 11 (note: brand-table wallet differs from on-chain creator) |
| The Year Of... | `tyo` | `0xf78cb04c28e1898638ee4322f4b7b91ee8c0db00` (agent #47353, registered 2026-05-11; client payout sweeps to Tony's `0x699e234a877ba075e1f16abb63f895a8a2250388`) | active / live | 29, 35 (2) via Tony's original wallet; 30 via DrHobbs | 3 across two creators |
| Unknown Union | `unknown-union` | `0xe7ed24a6a66170070c725451c003917da83871da` | active / live | 63-572 | 87 |

### Brand-table-wallet vs on-chain-creator mismatches

These are not errors, they are historic. Tokens minted before a brand was handed off carry the holding-wallet (or an admin wallet) as `creator_wallet`, while the brand row's `wallet_address` was updated at handoff. For accounting Colin needs both:

- The **brand row wallet** is where the off-chain auto-payout sends the brand's share today.
- The **token `creator_wallet`** is what the on-chain `mintWithPermit` 70% transfer pays. For brand-owned drops this should be `PLATFORM_WALLET`. For non-brand drops it is the original creator (Richard, a brand owner, etc).

Confirmed mismatches (token range : on-chain creator vs current brand wallet):

- Nolo: tokens 568-570 created by `0x891c13aa...` (handoff intermediary), token 571 by current brand wallet `0x27daa49f...`.
- PassportADV: tokens 93-103 created by holding wallet `0x734a25fb...`, brand row now points to `0xb4febbe6...`.
- The Year Of...: token 30 created by DrHobbs, tokens 29 and 35 by Tony's original wallet `0x699e23...0388`. Brand row now points to RRG-managed agent wallet `0xf78cb04c...0db00` (agent #47353). Tony's wallet is retained as the client-payout destination; periodic USDC sweeps go from the agent wallet to Tony's wallet.
- Artemist: tokens 36, 39, 44 created by three different wallets (`0xe653...c375`, `0xc12e...0d75`, `0xf2e7...4b3e`); brand row now points to `0x2c9a1dad...`.

## 4. Shared holding wallet (RRG Test Brands)

| Address | Role |
|---------|------|
| `0x734a25fB869ab6415b78bbe9a39f1f99dab349E7` | Default `wallet_address` and on-chain `creator_wallet` for any brand mirror not yet handed off. USDC received here is a **liability** owed to the eventual brand owner at handoff, less platform commission. |

Brands currently bound to this wallet (status = active, onboarding_status = in_progress unless noted, contact_email = `richard@entrepot.asia` in all cases):

| Brand | Slug | Token range | Token count |
|-------|------|-------------|-------------|
| '47 | `47brand` | 596-599 | 4 |
| 13DE MARZO | `13-de-marzo` | 283-287 | 5 |
| Adapt | `adapt` | 229-233 | 5 |
| BOBBYJOSEPH | `bobby-joseph` | 183-187 | 5 |
| De La Soul | `de-la-soul` | 248-252 | 5 |
| Eye Club | `eye-club` | 263-267 | 5 |
| FULLYPAID CLOTHING | `fully-paid` | 600-604 | 5 |
| Goodhood | `goodhood` | 268-272 | 5 |
| Gumball 3000 | `gumball-3000` | 224-228 | 5 |
| HoMie | `homie-au` | 492-501 | 10 |
| howies | `howies` | 344-487 | 144 |
| Jolie | `jolie` | 574 | 1 |
| LES BASICS | `les-basics` | 219-223 | 5 |
| Maison Archive | `maison-archive` | 78-82 | 5 |
| New Era | `new-era` | 508-515 | 8 |
| Nigel Cabourn | `cabourn` | 278-282 | 5 |
| Nous Research | `nous-research` | 575-590 | 16 |
| Philleywood | `philleywood` | 330-343 | 14 |
| Pitchers Only | `pitchers-only` | 643-647 | 5 |
| Private White V.C. | `private-white-vc` | 502-507 | 6 |
| Pudgy Penguins | `pudgy-penguins` | 605-610 | 6 |
| Shoyoroll | `shoyoroll` | 253-257 | 5 |
| Soulland | `soulland` | 591-595 | 5 |
| Stadium Goods | `stadium-goods` | 302 | 1 |
| Standard & Strange | `standard-and-strange` | 238-301 | 19 |
| Stuart Trevor | `stuart-trevor` | 258-262 | 5 |
| The Merchant Fox | `the-merchant-fox` | 213-217 | 5 |
| Toshi the Cat | `toshi` | 611-615 | 5 |
| Unit 9 | `unit9` | 616-642 | 27 |
| University of Diversity | `university-of-diversity` | 188 | 1 |
| Vollebak | `vollebak` | 273-277 | 5 |
| WASHI | `washi-jeans` | 243-247 | 5 |
| WEINSANTO | `weinsanto` | 234-237 | 4 |

## 5. Other on-chain creator wallets seen on RRG submissions

These appear in `rrg_submissions.creator_wallet` but are not the current brand-table wallet for any brand. Useful only for historic-tx attribution.

| Address | Tokens | Brand context |
|---------|--------|---------------|
| `0x0e0ef55048fb7b68b06dec7a6413b086a7ec029a` | token 13 | RRG submission, original creator |
| `0x891c13aa323378637404efd971553a3a6df5aaf1` | tokens 568-570 (3) | Nolo handoff intermediary |
| `0xf2e7289889ea5ecc557439a134906f77a1d64b3e` | token 44 | Artemist, original creator |
| `0xf7bba988b1e9f28dcb293ed564b57f965ae1ec2b` | tokens 12, 19 (3 total) | RRG submission, original creator |

## 6. Contract constants (not wallets, for tx classification)

| Item | Address |
|------|---------|
| RRG ERC-1155 (live) | `0x9F07621f73E7CAaF2040C35833D5350F666b7177` |
| USDC (Base) | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` |
| Identity Registry (ERC-8004) | `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432` |
| Reputation Registry (ERC-8004) | `0x8004BAa17C55a88189AE136b182e5fdA19dE9b63` |

Deprecated RRG contract addresses (no current live drops, but historic txs may reference):

- `0x447692F5136798ACB111a3fB61FD4202668a6994` (mainnet v4)
- `0x1E1952Ae682252282f390CBa4b86c8A9de36778b` (mainnet v2)
- `0xA16fdbA6D13b2ea5ae31099bb2a5D22621B50DE7` (mainnet v1)
- `0x573fad302Be48df7D3A39B381e5E5e794619e174`, `0x3296e1AC4dd0ff665f82c7857D017841fAed311d` (Sepolia v1/v2)

## 7. Accounting rules Colin should encode

1. **DrHobbs and RRG are separate ledgers.** `0xe65380...c375` movements never reconcile against RRG platform P&L. Personal-vs-platform classification is the first split in any tx.
2. **DEPLOYER is opex.** Gas top-ups to `0x369d04...660b` are operating expense, attributable to whichever signing operation triggered the burn (operatorMint, ERC-8004 signal, deploy script).
3. **PLATFORM_WALLET inbound = gross revenue.** Treat USDC inbound to `0xbfd71e...b7ed` as gross sales. The off-chain auto-payout outbound is cost-of-sales (97.5% to brand for brand-owned drops). Do not net into a single line.
4. **Holding-wallet receipts are a liability.** USDC in `0x734a25...49E7` for a not-yet-handed-off brand is owed to that brand at handoff. Track per-brand subledgers using the token ranges in section 4.
5. **Brand-owned wallet inbound is the brand's cash, not ours.** Platform commission already settled by auto-payout split.
6. **Section 2 personal wallets are personal.** Even when bound to a brand row, classify movements as Richard's personal until the brand is handed off and the wallet is replaced.
7. **Token creator mismatch flag.** When a sale completes, the on-chain 70% lands at `getDrop(tokenId).creator`, not at the brand row's `wallet_address`. For brand-owned drops these should both resolve to `PLATFORM_WALLET`. If they ever diverge, see [feedback_register_drop_creator_must_be_platform.md](../../.claude/projects/C--Users-Richard-Documents-rrg/memory/feedback_register_drop_creator_must_be_platform.md) for the post-mortem and remediation pattern.

## 8. Operational note: keeping this file fresh

Authoritative live source for brand wallets is the `wallet_address` column in `app_sellers`. For token-level attribution it is `creator_wallet` in `rrg_submissions`. Recommended Colin job (daily):

```sql
-- Brand wallets
SELECT id, name, slug, wallet_address, status, onboarding_status, tier, contact_email
FROM app_sellers
ORDER BY created_at;

-- Token creators
SELECT s.creator_wallet, b.name, b.slug, COUNT(*) AS tokens, MIN(s.token_id) AS min_t, MAX(s.token_id) AS max_t
FROM rrg_submissions s
LEFT JOIN app_sellers b ON s.brand_id = b.id
WHERE s.creator_wallet IS NOT NULL AND s.token_id IS NOT NULL
GROUP BY s.creator_wallet, b.name, b.slug
ORDER BY s.creator_wallet, b.name;
```

A daily diff against the prior snapshot will catch:
- New brands being onboarded (new rows, holding-wallet bound).
- Handoffs (brand wallet changes from holding wallet to brand-owned).
- New tokens minted (extends token ranges).

`.env.example` line 14 currently shows `NEXT_PUBLIC_PLATFORM_WALLET=0xe653804032A2d51Cc031795afC601B9b1fd2c375` (the DrHobbs address). Production env on the VPS uses the RRG wallet, and the runtime fallback in `lib/app/splits.ts` and elsewhere is also the RRG wallet, so live behaviour is correct. The example file is misleading and should be corrected in a follow-up.

## 9. Where to find transfer data for reconciliation

Three sources, in order of preference:

### 9.1 Internal: `app_purchases` table (Supabase)

The platform's own ledger of sales. Authoritative for any RRG-mediated purchase. Project ID `sanvqnvvzdkjvfmxnxur`. Columns useful to Colin:

| Column | Meaning |
|--------|---------|
| `id`, `created_at` | Sale primary key and timestamp |
| `tx_hash` | The on-chain mint/payment tx (links to Basescan) |
| `payout_tx_hashes` | Comma-separated tx hashes for the off-chain auto-payout to brand and platform shares |
| `amount_usdc` | Gross USDC received from buyer |
| `split_creator_usdc`, `split_brand_usdc`, `split_platform_usdc` | The three legs of the split |
| `split_model` | `brand_product_flat`, `seller_product_tiered`, etc. Drives which split rule fires |
| `brand_pct_applied` | The actual percentage paid to the brand (default 97.5% for brand-owned) |
| `buyer_wallet`, `buyer_email`, `buyer_type` | Counterparty for AR / customer subledger |
| `network` | `base` for almost all current sales |
| `payment_method` | `crypto`, `card`, etc. Card sales bypass the on-chain tx |

Reconciliation query pattern (per period):

```sql
SELECT created_at::date AS d,
       COUNT(*) AS sales,
       SUM(amount_usdc) AS gross_usdc,
       SUM(split_brand_usdc) AS to_brand,
       SUM(split_platform_usdc) AS to_platform,
       SUM(split_creator_usdc) AS to_creator
FROM app_purchases
WHERE network = 'base'
  AND created_at >= '2026-02-01'
GROUP BY 1 ORDER BY 1;
```

Every row's `tx_hash` and each hash in `payout_tx_hashes` should match an inbound or outbound transfer on the relevant wallet at the explorer. Mismatches = investigation flag.

### 9.2 External: Blockscout V2 (free, recommended for ad-hoc lookups)

Base mainnet Blockscout instance: `https://base.blockscout.com`. No API key needed. Cursor-paginated via `next_page_params`.

Useful endpoints (replace `{addr}` with a checksummed wallet address):

| Endpoint | Returns |
|----------|---------|
| `/api/v2/addresses/{addr}` | Current balance, ETH and major tokens |
| `/api/v2/addresses/{addr}/transactions` | All native-ETH txs (in and out, includes failed) |
| `/api/v2/addresses/{addr}/token-transfers?type=ERC-20` | All ERC-20 transfers in/out (paginated, filter client-side by `token.address_hash`) |
| `/api/v2/addresses/{addr}/token-balances` | Current token balances by contract |

**Important:** the `?token=ADDRESS` query param does NOT filter on the server. Always filter the response client-side by `token.address_hash` to drop phishing tokens that spoof USDC's name and symbol. The real USDC is `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` (case-insensitive compare).

Reconciliation script in this repo: [`scripts/reconcile-wallets.mjs`](../scripts/reconcile-wallets.mjs). Run with `node scripts/reconcile-wallets.mjs` from the repo root. Pulls all 21 wallets in this register (every group: core operating, personal pre-handoff, brand-owned, holding, historic creators), writes a markdown report to `docs/wallet-reconciliation-YYYY-MM-DD.md`, and prints a JSON dump to stdout. Uses chunked concurrency (4 wallets at a time) to respect Blockscout rate limits. First snapshot: [`wallet-reconciliation-2026-05-10.md`](wallet-reconciliation-2026-05-10.md).

### 9.3 External: Etherscan unified V2 (paid, only if free tier insufficient)

`https://api.etherscan.io/v2/api?chainid=8453&module=account&action=tokentx|txlist&...` with `BASESCAN_API_KEY` from `.env.local`. As of 2026-05, the V2 unified API requires a paid plan to query Base. The free tier returns "Free API access is not supported for this chain. Please upgrade your api plan." Keep the key as a fallback for the day Etherscan upgrades free tier or we move to a paid plan.

### 9.4 Reconciliation cadence (suggested)

- **Daily.** Pull the last 24h from Blockscout for the four core operating wallets (PLATFORM, DEPLOYER, holding, DrHobbs) and the four personal pre-handoff wallets. Diff against `app_purchases` `tx_hash` and `payout_tx_hashes` for the same period. Flag any tx not in `app_purchases` for manual classification.
- **Weekly.** Re-pull the 90-day window for the personal wallets (the four in section 2) and update the markdown report. Compare against the prior week's snapshot to catch any stale balances.
- **Monthly.** Reconcile end-of-month balances on every wallet against the Zoho asset accounts. Discrepancy threshold: 0.01 USDC.
- **At handoff.** When a brand is handed off, run the reconciliation script for both the old (holding or personal) wallet and the new brand-owned wallet over the full pre-handoff window. The token-range mismatches in section 3 of this doc are pre-existing as of 2026-05-09.

### 9.5 Pre-matched purchase ledger

The reconciliation script in 9.2 covers the wallet-level on-chain history. To pre-match each `app_purchases` row against the on-chain tx (so daily booking is data-entry, not detective work), run the companion script:

`node scripts/match-purchases.mjs` queries Supabase live (no JSON snapshot needed), verifies every tx_hash on both Base mainnet and Base Sepolia, and writes `docs/wallet-matching-{TODAY}.md`. Each purchase is categorised as: real mainnet (book), mislabelled (DO NOT BOOK), correctly-labelled Sepolia (DO NOT BOOK), or orphan (investigate). Section 2 of the report is the verified mainnet ledger. Section 6 is the unaccounted on-chain tx that need Richard's classification. Section 7 is the counterparty key.

First snapshot: [`wallet-matching-2026-05-10.md`](wallet-matching-2026-05-10.md).

### 9.6 Data-quality cleanup (2026-05-10): network column backfilled, Sepolia rows removed

On 2026-05-10, [`scripts/fix-purchases-network.mjs`](../scripts/fix-purchases-network.mjs) was run with `--apply` to:

- Verify every `app_purchases.tx_hash` against both Base mainnet and Base Sepolia via Blockscout.
- Update the `network` column for 13 rows mislabelled as `base-sepolia` but verified on mainnet (real April-May Clooudie / Frey / Nolo / Unknown Union sales).
- Update the `network` column for 22 rows mislabelled as `base` but verified on Sepolia (intermediate step before delete).
- DELETE 22 verified-Sepolia rows (testnet, no accounting value).

After cleanup: 28 rows remain in `app_purchases`, all `network='base'`. Of those, 17 are verified on Base mainnet (book as revenue) and 11 are orphan rows whose tx is not found on either chain (March 10-13 cluster, gross 8.00 USDC, untouched pending Richard's review).

Going forward, the `network` column should be reliable. Re-run the fix script after any re-deployment of the platform from a Sepolia-configured environment, and any time orphans need to be re-checked (Blockscout indexing can change).

### 9.7 Counterparty key (most-frequent counterparties seen in tx history)

For the canonical key with verified-counterparty identities and Zoho classification recommendations, see section 7 of [`wallet-matching-2026-05-10.md`](wallet-matching-2026-05-10.md). Key entries identified via on-chain investigation 2026-05-10:

- `0xe3478b0BB1A5084567C319096437924948Be1964` = **MetaMask: Gas Station Swap** (Etherscan public tag). Skims MetaMask's swap fee from in-app swaps performed by the DFW brand wallet. Classify as "Infrastructure / wallet-provider swap fees", reconcile to parent swap tx.
- `0x9f783931cedc82c538028fb9be5289a38bc395df` = anonymous EOA, RRG-only NFT holdings, pattern matches sponsored / gasless mint flow. Original buyer row (token 17, 2026-03-08) was Sepolia and deleted in the cleanup.
- `0x25B22971892B7314c36EC6DCfB5537500d50Ea35` = Sepolia test buyer on a row deleted in the cleanup.

These addresses come up repeatedly in the tx tables and are worth labelling in Zoho contact lists:

| Address | Label |
|---------|-------|
| `0xbfd71eA27FFc99747dA2873372f84346d9A8b7ed` | RRG / PLATFORM_WALLET (this register) |
| `0x369d04F08F245454926AC96a0164a634fd94660B` | DEPLOYER (this register) |
| `0xe3478b0BB1A5084567C319096437924948Be1964` | Recurring small-amount counterparty in DFW history. Identity to confirm before classifying. |
| `0x2C9a1DAdD6Cb5425Bf0e677FAdA64a257a558438` | Artemist brand wallet (this register, section 3) |
| `0x25B22971892B7314c36EC6DCfB5537500d50Ea35` | Recurring counterparty. Identity to confirm. |
