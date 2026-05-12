#!/usr/bin/env node
/**
 * scripts/regen-wallets-md.mjs
 *
 * Regenerate docs/wallets.md from Supabase. Standalone Node script — does
 * not boot Next.js. Mirror of lib/rrg/wallets-doc.ts. Keep them in sync.
 *
 * Usage:
 *   node scripts/regen-wallets-md.mjs
 *
 * Reads NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_KEY from .env.local.
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

// ── Load .env.local ─────────────────────────────────────────────────────
try {
  for (const line of readFileSync(resolve(process.cwd(), '.env.local'), 'utf8').split('\n')) {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (m) {
      const k = m[1].trim();
      const v = m[2].trim().replace(/^["']|["']$/g, '');
      if (!process.env[k]) process.env[k] = v;
    }
  }
} catch {
  console.error('FATAL: could not read .env.local');
  process.exit(1);
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('FATAL: NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_KEY not set in .env.local');
  process.exit(1);
}

const db = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });

// ── Constants (mirror of lib/rrg/wallets-doc.ts) ────────────────────────

const HOLDING_WALLET = '0x734a25fb869ab6415b78bbe9a39f1f99dab349e7';

const PERSONAL_PRE_HANDOFF = [
  {
    address: '0x61e01997e6a0c692656e94955c67cb3ebcab8f19',
    notes: 'Also on-chain creator for tokens 28-33 (3 tokens).',
  },
  {
    address: '0xc12ecf02448e0e56dad9c0d5473553b80d030d75',
    notes: 'Heavy historical use as on-chain creator: RRG tokens 4-26 (11 tokens), East Coast Cassettes token 34, Artemist token 39.',
  },
  {
    address: '0xdb59cd2c8f9c6e576510bf7ed294654f41241b65',
    notes: 'Personal wallet, not yet attached to a brand record. Top-ups recorded as personal, not platform.',
  },
  {
    address: '0xe653804032a2d51cc031795afc601b9b1fd2c375',
    notes: 'Same address as the DrHobbs agent in section 1. Historic on-chain creator for RRG tokens 5-38, Artemist 36, LIVVIUM 40-41, TYO 30, plus token 27 with no brand binding.',
  },
];

const HISTORIC_CREATOR_NOTES = [
  { address: '0x0e0ef55048fb7b68b06dec7a6413b086a7ec029a', notes: 'RRG submission, original creator' },
  { address: '0x891c13aa323378637404efd971553a3a6df5aaf1', notes: 'Nolo handoff intermediary' },
  { address: '0xf2e7289889ea5ecc557439a134906f77a1d64b3e', notes: 'Artemist, original creator' },
  { address: '0xf7bba988b1e9f28dcb293ed564b57f965ae1ec2b', notes: 'RRG submission, original creator' },
];

// ── Helpers ─────────────────────────────────────────────────────────────

const lc = (a) => (a ?? '').toLowerCase();
const tokenRange = (min, max) => (min === max ? `${min}` : `${min}-${max}`);
const statusCell = (b) => `${b.status ?? 'unknown'} / ${b.onboarding_status ?? 'unknown'}`;
const summariseStats = (s) => (!s || s.count === 0 ? 'n/a' : tokenRange(s.min, s.max));

// ── Static template (mirror of lib/rrg/wallets-doc.ts) ──────────────────

function section1_header(today) {
  return `# Wallet Register

Source of truth for accounting. All addresses are on Base mainnet (chain ID 8453) unless otherwise stated. Values pulled from Supabase (\`rrg_brands\`, \`rrg_submissions\`) on ${today} and from canonical memory files (\`wallet_separation.md\`, \`via_labs_structure.md\`).

This file is the input for Agent Colin (admin) to build a chart of accounts and bookkeeping ledger. When a wallet is added, removed, or handed off to a brand owner, update this file and Colin's snapshot job.

## 1. Core operating wallets

These are the wallets that get topped up for operations. Treat as company-controlled.

| Role | ERC-8004 ID | Address | Notes |
|------|------|---------|-------|
| RRG / PLATFORM_WALLET | 33313 | \`0xbfd71eA27FFc99747dA2873372f84346d9A8b7ed\` | Platform agent. Receives on-chain 70% (or 97.5% for brand-owned drops) at sale. All RRG outreach, x402 receipts, marketing-oracle disbursements. Also the wallet referenced by \`process.env.NEXT_PUBLIC_PLATFORM_WALLET\` runtime fallback in \`lib/rrg/splits.ts\`, \`lib/rrg/sendUsdc.ts\`, \`lib/rrg/mpp.ts\`. |
| DEPLOYER | 26244 | \`0x369d04f08f245454926ac96a0164a634fd94660b\` | Gas-only signer. Pays gas for \`operatorMint\` and ERC-8004 \`submitFeedback\`. Should hold ETH on Base only, no USDC. Cost centre. |
| VIA Team Wallet | (owns #38538) | \`0x58554E8423EF5C10be6fFC82EfABA9149f64de3d\` | VIA Labs corporate. Owns staff and company NFTs. Owner of VIA Labs agent #38538 (getvia.xyz). x402 corporate wallet. Also the on-chain creator of two Digital Fashion Week tokens (42, 43). |
| DrHobbs (personal) | 17666 | \`0xe653804032A2d51Cc031795afC601B9b1fd2c375\` | Richard's personal agent. Knowledge marketplace, x402, fashion-tech experiments. NOT used for RRG platform flows. Also flagged as a personal-pre-handoff wallet (see section 2) and historic on-chain creator of several test tokens. |
`;
}

function section6_to_9() {
  return `## 6. Contract constants (not wallets, for tx classification)

| Item | Address |
|------|---------|
| RRG ERC-1155 (live) | \`0x9F07621f73E7CAaF2040C35833D5350F666b7177\` |
| USDC (Base) | \`0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913\` |
| Identity Registry (ERC-8004) | \`0x8004A169FB4a3325136EB29fA0ceB6D2e539a432\` |
| Reputation Registry (ERC-8004) | \`0x8004BAa17C55a88189AE136b182e5fdA19dE9b63\` |

Deprecated RRG contract addresses (no current live drops, but historic txs may reference):

- \`0x447692F5136798ACB111a3fB61FD4202668a6994\` (mainnet v4)
- \`0x1E1952Ae682252282f390CBa4b86c8A9de36778b\` (mainnet v2)
- \`0xA16fdbA6D13b2ea5ae31099bb2a5D22621B50DE7\` (mainnet v1)
- \`0x573fad302Be48df7D3A39B381e5E5e794619e174\`, \`0x3296e1AC4dd0ff665f82c7857D017841fAed311d\` (Sepolia v1/v2)

## 7. Accounting rules Colin should encode

1. **DrHobbs and RRG are separate ledgers.** \`0xe65380...c375\` movements never reconcile against RRG platform P&L. Personal-vs-platform classification is the first split in any tx.
2. **DEPLOYER is opex.** Gas top-ups to \`0x369d04...660b\` are operating expense, attributable to whichever signing operation triggered the burn (operatorMint, ERC-8004 signal, deploy script).
3. **PLATFORM_WALLET inbound = gross revenue.** Treat USDC inbound to \`0xbfd71e...b7ed\` as gross sales. The off-chain auto-payout outbound is cost-of-sales (97.5% to brand for brand-owned drops). Do not net into a single line.
4. **Holding-wallet receipts are a liability.** USDC in \`0x734a25...49E7\` for a not-yet-handed-off brand is owed to that brand at handoff. Track per-brand subledgers using the token ranges in section 4.
5. **Brand-owned wallet inbound is the brand's cash, not ours.** Platform commission already settled by auto-payout split.
6. **Section 2 personal wallets are personal.** Even when bound to a brand row, classify movements as Richard's personal until the brand is handed off and the wallet is replaced.
7. **Token creator mismatch flag.** When a sale completes, the on-chain 70% lands at \`getDrop(tokenId).creator\`, not at the brand row's \`wallet_address\`. For brand-owned drops these should both resolve to \`PLATFORM_WALLET\`. If they ever diverge, see [feedback_register_drop_creator_must_be_platform.md](../../.claude/projects/C--Users-Richard-Documents-rrg/memory/feedback_register_drop_creator_must_be_platform.md) for the post-mortem and remediation pattern.

## 8. Operational note: keeping this file fresh

Authoritative live source for brand wallets is the \`wallet_address\` column in \`rrg_brands\`. For token-level attribution it is \`creator_wallet\` in \`rrg_submissions\`. This file is regenerated automatically by \`lib/rrg/wallets-doc.ts\` whenever a brand is marked live via \`POST /api/rrg/admin/onboarding-complete\`. Manual rebuild: \`node scripts/regen-wallets-md.mjs\`.

\`.env.example\` line 14 currently shows \`NEXT_PUBLIC_PLATFORM_WALLET=0xe653804032A2d51Cc031795afC601B9b1fd2c375\` (the DrHobbs address). Production env on the VPS uses the RRG wallet, and the runtime fallback in \`lib/rrg/splits.ts\` and elsewhere is also the RRG wallet, so live behaviour is correct. The example file is misleading and should be corrected in a follow-up.

## 9. Where to find transfer data for reconciliation

Three sources, in order of preference:

### 9.1 Internal: \`rrg_purchases\` table (Supabase)

The platform's own ledger of sales. Authoritative for any RRG-mediated purchase. Project ID \`sanvqnvvzdkjvfmxnxur\`. Columns useful to Colin: \`tx_hash\`, \`payout_tx_hashes\`, \`amount_usdc\`, \`split_creator_usdc\`, \`split_brand_usdc\`, \`split_platform_usdc\`, \`split_model\`, \`brand_pct_applied\`, \`buyer_wallet\`, \`buyer_email\`, \`buyer_type\`, \`network\`, \`payment_method\`.

### 9.2 External: Blockscout V2 (free, recommended for ad-hoc lookups)

Base mainnet Blockscout instance: \`https://base.blockscout.com\`. No API key needed. Reconciliation script: [\`scripts/reconcile-wallets.mjs\`](../scripts/reconcile-wallets.mjs).

### 9.3 External: Etherscan unified V2 (paid, only if free tier insufficient)

\`https://api.etherscan.io/v2/api?chainid=8453\`. Requires \`BASESCAN_API_KEY\` and a paid plan for Base. Keep as fallback.

### 9.4 Reconciliation cadence (suggested)

- Daily: pull last 24h for the four core operating wallets.
- Weekly: re-pull 90-day window for the personal wallets in section 2.
- Monthly: reconcile end-of-month balances against Zoho asset accounts (0.01 USDC threshold).
- At handoff: full pre-handoff reconciliation across both old and new wallets.
`;
}

// ── Data-driven section renderers ───────────────────────────────────────

function renderSection2(brands) {
  const lines = [
    '## 2. Personal wallets used as brand placeholders before handoff',
    '',
    'Owned by Richard. Used as the brand `wallet_address` while a brand is in pre-handoff state. Once the brand owner accepts terms and provides their wallet, these get swapped out.',
    '',
    '| Address | Currently bound to | DB status | Notes |',
    '|---------|--------------------|-----------|-------|',
  ];
  for (const p of PERSONAL_PRE_HANDOFF) {
    const bound = brands.filter((b) => lc(b.wallet_address) === p.address);
    const boundCell = bound.length === 0 ? 'Not currently bound to any brand in DB' : bound.map((b) => `${b.name} (\`${b.slug}\`)`).join(', ');
    const statusCellText = bound.length === 0 ? 'n/a' : bound.map(statusCell).join(' / ');
    lines.push(`| \`${p.address}\` | ${boundCell} | ${statusCellText} | ${p.notes} |`);
  }
  return lines.join('\n') + '\n';
}

function renderSection3(brands, stats) {
  const personalSet = new Set(PERSONAL_PRE_HANDOFF.map((p) => p.address));
  const owned = brands.filter((b) => {
    const w = lc(b.wallet_address);
    if (!w) return false;
    if (w === HOLDING_WALLET) return false;
    if (personalSet.has(w)) return false;
    return true;
  });
  owned.sort((a, b) => a.name.localeCompare(b.name));

  const lines = [
    '## 3. Brand-owned wallets (handed off, brand controls funds)',
    '',
    "Inbound USDC to these is the brand's cash. Platform sees only the 2.5% commission, paid via `lib/rrg/auto-payout.ts` before the brand transfer.",
    '',
    '| Brand | Slug | Wallet | DB status | ERC-8004 ID | Token range | Token count |',
    '|-------|------|--------|-----------|-------------|-------------|-------------|',
  ];
  for (const b of owned) {
    const s = stats.get(b.id);
    const w = b.wallet_address ?? '';
    const agentId = b.erc8004_agent_id != null ? `${b.erc8004_agent_id}` : 'n/a';
    lines.push(`| ${b.name} | \`${b.slug}\` | \`${w}\` | ${statusCell(b)} | ${agentId} | ${summariseStats(s)} | ${s?.count ?? 0} |`);
  }

  const mismatchLines = [];
  for (const b of owned) {
    const s = stats.get(b.id);
    if (!s) continue;
    const brandWallet = lc(b.wallet_address);
    const otherCreators = [...s.creators.entries()].filter(([addr]) => addr !== brandWallet);
    if (otherCreators.length === 0) continue;
    const summary = otherCreators.map(([addr, count]) => `\`${addr}\` (${count} token${count === 1 ? '' : 's'})`).join(', ');
    mismatchLines.push(`- ${b.name}: ${summary}`);
  }

  lines.push('');
  lines.push('### Brand-table-wallet vs on-chain-creator mismatches');
  lines.push('');
  lines.push("These are not errors, they are historic. Tokens minted before a brand was handed off carry the holding-wallet (or an admin wallet) as `creator_wallet`, while the brand row's `wallet_address` was updated at handoff. For accounting Colin needs both:");
  lines.push('');
  lines.push("- The **brand row wallet** is where the off-chain auto-payout sends the brand's share today.");
  lines.push('- The **token `creator_wallet`** is what the on-chain `mintWithPermit` 70% transfer pays. For brand-owned drops this should be `PLATFORM_WALLET`. For non-brand drops it is the original creator (Richard, a brand owner, etc).');
  lines.push('');
  if (mismatchLines.length === 0) {
    lines.push('No mismatches detected at last regen.');
  } else {
    lines.push('Confirmed mismatches (brand : on-chain creators that differ from current brand wallet):');
    lines.push('');
    lines.push(...mismatchLines);
  }
  return lines.join('\n') + '\n';
}

function renderSection4(brands, stats) {
  const held = brands.filter((b) => lc(b.wallet_address) === HOLDING_WALLET);
  held.sort((a, b) => a.name.localeCompare(b.name));

  const lines = [
    '## 4. Shared holding wallet (RRG Test Brands)',
    '',
    '| Address | Role |',
    '|---------|------|',
    '| `0x734a25fB869ab6415b78bbe9a39f1f99dab349E7` | Default `wallet_address` and on-chain `creator_wallet` for any brand mirror not yet handed off. USDC received here is a **liability** owed to the eventual brand owner at handoff, less platform commission. |',
    '',
    'Brands currently bound to this wallet:',
    '',
    '| Brand | Slug | DB status | Token range | Token count | Contact email |',
    '|-------|------|-----------|-------------|-------------|---------------|',
  ];
  for (const b of held) {
    const s = stats.get(b.id);
    lines.push(`| ${b.name} | \`${b.slug}\` | ${statusCell(b)} | ${summariseStats(s)} | ${s?.count ?? 0} | ${b.contact_email ?? ''} |`);
  }
  return lines.join('\n') + '\n';
}

function renderSection5(brands, allCreators) {
  const exclude = new Set([
    HOLDING_WALLET,
    '0xbfd71ea27ffc99747da2873372f84346d9a8b7ed',
    '0x369d04f08f245454926ac96a0164a634fd94660b',
    '0x58554e8423ef5c10be6ffc82efaba9149f64de3d',
    ...PERSONAL_PRE_HANDOFF.map((p) => p.address),
    ...brands.map((b) => lc(b.wallet_address)).filter((s) => s),
  ]);
  const noteByAddr = new Map(HISTORIC_CREATOR_NOTES.map((h) => [h.address, h.notes]));
  const orphans = [...allCreators.entries()].filter(([addr]) => !exclude.has(addr)).sort((a, b) => a[0].localeCompare(b[0]));

  const lines = [
    '## 5. Other on-chain creator wallets seen on RRG submissions',
    '',
    'These appear in `rrg_submissions.creator_wallet` but are not the current brand-table wallet for any brand. Useful only for historic-tx attribution.',
    '',
    '| Address | Tokens | Brand context |',
    '|---------|--------|---------------|',
  ];
  for (const [addr, count] of orphans) {
    const note = noteByAddr.get(addr) ?? 'Unclassified historic creator. Investigate before booking.';
    lines.push(`| \`${addr}\` | ${count} | ${note} |`);
  }
  if (orphans.length === 0) lines.push('| (none) | 0 | All on-chain creators map to a known wallet. |');
  return lines.join('\n') + '\n';
}

// ── Data fetch ──────────────────────────────────────────────────────────

async function fetchBrandsAndSubmissions() {
  const { data: brandsRaw, error: bErr } = await db
    .from('rrg_brands')
    .select('id, name, slug, wallet_address, status, onboarding_status, contact_email, erc8004_agent_id')
    .order('name', { ascending: true });
  if (bErr) throw new Error(`rrg_brands fetch failed: ${bErr.message}`);
  const brands = brandsRaw ?? [];

  const submissions = [];
  const PAGE = 1000;
  let from = 0;
  for (let page = 0; page < 100; page++) {
    const { data, error } = await db
      .from('rrg_submissions')
      .select('brand_id, token_id, creator_wallet')
      .not('token_id', 'is', null)
      .range(from, from + PAGE - 1)
      .order('token_id', { ascending: true });
    if (error) throw new Error(`rrg_submissions fetch failed: ${error.message}`);
    const rows = data ?? [];
    submissions.push(...rows);
    if (rows.length < PAGE) break;
    from += PAGE;
  }

  const stats = new Map();
  for (const s of submissions) {
    if (!s.brand_id || s.token_id == null) continue;
    let entry = stats.get(s.brand_id);
    if (!entry) {
      entry = { count: 0, min: s.token_id, max: s.token_id, creators: new Map() };
      stats.set(s.brand_id, entry);
    }
    entry.count += 1;
    if (s.token_id < entry.min) entry.min = s.token_id;
    if (s.token_id > entry.max) entry.max = s.token_id;
    const c = lc(s.creator_wallet);
    if (c) entry.creators.set(c, (entry.creators.get(c) ?? 0) + 1);
  }

  const allCreators = new Map();
  for (const s of submissions) {
    const c = lc(s.creator_wallet);
    if (!c) continue;
    allCreators.set(c, (allCreators.get(c) ?? 0) + 1);
  }
  return { brands, stats, allCreators };
}

// ── Main ────────────────────────────────────────────────────────────────

const today = new Date().toISOString().slice(0, 10);
const { brands, stats, allCreators } = await fetchBrandsAndSubmissions();
const markdown = [
  section1_header(today),
  renderSection2(brands),
  renderSection3(brands, stats),
  renderSection4(brands, stats),
  renderSection5(brands, allCreators),
  section6_to_9(),
].join('\n');

const outPath = resolve(process.cwd(), 'docs', 'wallets.md');
writeFileSync(outPath, markdown, 'utf8');
console.log(`[regen-wallets-md] wrote ${markdown.length} chars to ${outPath}`);
console.log(`[regen-wallets-md] brands=${brands.length} owned=${[...stats.keys()].length} historic=${allCreators.size}`);
