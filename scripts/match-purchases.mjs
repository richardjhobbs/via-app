#!/usr/bin/env node
// Cross-matches app_purchases against on-chain transfer history (Blockscout V2) for every wallet
// in the register. Produces a single comprehensive markdown report at
// docs/wallet-matching-{TODAY}.md so Colin can pre-populate Zoho.
//
// Default: queries Supabase live via service-role key from .env.local.
// Override: pass a JSON snapshot path as argv[1] to use a frozen-in-time snapshot.

import { readFileSync, writeFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

const PURCHASES_PATH = process.argv[2] || null;
const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const TODAY = new Date().toISOString().slice(0, 10);

// Wallets we pull on-chain history for. Any tx_hash referenced by app_purchases on `network='base'`
// should appear on at least one of these wallets' history.
const WATCHED = [
  { label: 'PLATFORM_WALLET',           addr: '0xbfd71eA27FFc99747dA2873372f84346d9A8b7ed' },
  { label: 'DEPLOYER',                  addr: '0x369d04f08f245454926ac96a0164a634fd94660b' },
  { label: 'DrHobbs personal',          addr: '0xe653804032A2d51Cc031795afC601B9b1fd2c375' },
  { label: 'East Coast Cassettes',      addr: '0x61e01997e6a0C692656e94955c67CB3ebcAb8f19' },
  { label: 'Digital Fashion Week',      addr: '0xc12Ecf02448e0E56DAd9C0D5473553b80d030D75' },
  { label: 'Holding wallet',            addr: '0x734a25fB869ab6415b78bbe9a39f1f99dab349E7' },
  { label: 'Artemist',                  addr: '0x2c9a1dadd6cb5425bf0e677fada64a257a558438' },
  { label: 'Clooudie',                  addr: '0xca5c9c4da1787fea491ed6c94e86b04ec46be61d' },
  { label: 'Frey Tailored',             addr: '0x30b1e8cc377a75d9664c26415a820c4925afa595' },
  { label: 'Nolo',                      addr: '0x27daa49fb93445cdb6e3f3a6be7cd6bae1f04e2d' },
  { label: 'Original RRG creator',      addr: '0x0e0ef55048fb7b68b06dec7a6413b086a7ec029a' },
  { label: 'RRG submission creator',    addr: '0xf7bba988b1e9f28dcb293ed564b57f965ae1ec2b' },
];

async function fetchJson(url) {
  const r = await fetch(url);
  return r.json();
}

async function paginate(baseUrl) {
  const items = [];
  let url = baseUrl;
  for (let page = 0; page < 30; page++) {
    const resp = await fetchJson(url);
    if (!Array.isArray(resp.items)) break;
    items.push(...resp.items);
    if (!resp.next_page_params) break;
    const qs = new URLSearchParams(resp.next_page_params).toString();
    url = `${baseUrl}${baseUrl.includes('?') ? '&' : '?'}${qs}`;
  }
  return items;
}

async function pullWallet(w) {
  const items = await paginate(`https://base.blockscout.com/api/v2/addresses/${w.addr}/token-transfers?type=ERC-20`);
  return items
    .filter(t => t.token && t.token.address_hash && t.token.address_hash.toLowerCase() === USDC.toLowerCase())
    .map(t => ({
      ts: t.timestamp,
      hash: (t.transaction_hash || '').toLowerCase(),
      from: ((t.from && t.from.hash) || '').toLowerCase(),
      to: ((t.to && t.to.hash) || '').toLowerCase(),
      value_usdc: Number((t.total && t.total.value) || 0) / 1e6,
      walletLabel: w.label,
      walletAddr: w.addr.toLowerCase(),
      direction: ((t.to && t.to.hash) || '').toLowerCase() === w.addr.toLowerCase() ? 'IN' : 'OUT',
    }));
}

let purchasesDoc;
if (PURCHASES_PATH) {
  purchasesDoc = JSON.parse(readFileSync(PURCHASES_PATH, 'utf8'));
} else {
  const ENV_PATH = process.env.RRG_ENV_PATH || '.env.local';
  const env = Object.fromEntries(readFileSync(ENV_PATH, 'utf8').split('\n').filter(l => l.includes('=')).map(l => {
    const i = l.indexOf('=');
    return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
  }));
  const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_KEY);
  console.error('Querying app_purchases live from Supabase...');
  const { data, error } = await sb
    .from('app_purchases')
    .select('id, created_at, tx_hash, payout_tx_hashes, amount_usdc, split_creator_usdc, split_brand_usdc, split_platform_usdc, split_model, brand_pct_applied, payment_method, network, buyer_wallet, token_id, brand_id, app_sellers(name, slug)')
    .order('created_at', { ascending: false });
  if (error) throw error;
  purchasesDoc = {
    snapshotDate: TODAY,
    rowCount: data.length,
    rows: data.map(r => ({
      id: r.id,
      created_at: r.created_at,
      tx_hash: r.tx_hash,
      payout_tx_hashes: r.payout_tx_hashes,
      amount_usdc: r.amount_usdc,
      split_creator_usdc: r.split_creator_usdc,
      split_brand_usdc: r.split_brand_usdc,
      split_platform_usdc: r.split_platform_usdc,
      split_model: r.split_model,
      brand_pct_applied: r.brand_pct_applied,
      payment_method: r.payment_method,
      network: r.network,
      buyer_wallet: r.buyer_wallet,
      token_id: r.token_id,
      brand_name: r.app_sellers?.name || null,
      slug: r.app_sellers?.slug || null,
    })),
  };
  console.error(`  loaded ${purchasesDoc.rows.length} rows`);
}
const purchases = purchasesDoc.rows;

console.error(`Pulling on-chain USDC for ${WATCHED.length} wallets (recent activity)...`);
const onChainByWallet = {};
const allOnChainTxs = new Map(); // tx_hash -> array of transfer events
for (let i = 0; i < WATCHED.length; i += 4) {
  const chunk = WATCHED.slice(i, i + 4);
  const results = await Promise.all(chunk.map(pullWallet));
  results.forEach((txs, idx) => {
    const w = chunk[idx];
    onChainByWallet[w.addr.toLowerCase()] = { label: w.label, addr: w.addr, txs };
    for (const t of txs) {
      if (!allOnChainTxs.has(t.hash)) allOnChainTxs.set(t.hash, []);
      allOnChainTxs.get(t.hash).push(t);
    }
  });
  process.stderr.write(`  pulled ${Math.min(i + 4, WATCHED.length)}/${WATCHED.length}\n`);
}

// The wallet-level pull caps at 30 pages and gets crowded with phishing tokens for older history.
// To match every purchase reliably, we also do a per-tx lookup for any app_purchases.tx_hash
// (and payout leg) that the wallet pull didn't catch. This is the authoritative match.
console.error(`Verifying every purchase tx hash on BOTH Base mainnet and Base Sepolia...`);
async function lookupTxOnChain(hash, chainHost) {
  try {
    const tx = await fetchJson(`https://${chainHost}/api/v2/transactions/${hash}`);
    if (tx && tx.hash) {
      const tt = await fetchJson(`https://${chainHost}/api/v2/transactions/${hash}/token-transfers`);
      const usdc = (Array.isArray(tt.items) ? tt.items : [])
        .filter(t => t.token && t.token.address_hash && t.token.address_hash.toLowerCase() === USDC.toLowerCase())
        .map(t => ({
          ts: t.timestamp,
          hash: hash.toLowerCase(),
          from: ((t.from && t.from.hash) || '').toLowerCase(),
          to: ((t.to && t.to.hash) || '').toLowerCase(),
          value_usdc: Number((t.total && t.total.value) || 0) / 1e6,
        }));
      return { found: true, status: tx.result, transfers: usdc };
    }
    return { found: false };
  } catch { return { found: false }; }
}

// Build the master verification map: tx_hash -> { mainnet, sepolia }
const txVerification = new Map();
const allHashes = new Set();
for (const p of purchasesDoc.rows) {
  if (p.tx_hash) allHashes.add(p.tx_hash.toLowerCase());
  if (p.payout_tx_hashes) {
    for (const leg of p.payout_tx_hashes.split('|')) {
      const [, h] = leg.split(':').map(s => s.trim());
      if (h) allHashes.add(h.toLowerCase());
    }
  }
}
const hashArr = [...allHashes];
for (let i = 0; i < hashArr.length; i += 8) {
  const chunk = hashArr.slice(i, i + 8);
  const results = await Promise.all(chunk.flatMap(h => [
    lookupTxOnChain(h, 'base.blockscout.com').then(r => ({ h, chain: 'mainnet', r })),
    lookupTxOnChain(h, 'base-sepolia.blockscout.com').then(r => ({ h, chain: 'sepolia', r })),
  ]));
  for (const { h, chain, r } of results) {
    if (!txVerification.has(h)) txVerification.set(h, { mainnet: null, sepolia: null });
    txVerification.get(h)[chain] = r;
  }
  process.stderr.write(`  verified ${Math.min(i + 8, hashArr.length)}/${hashArr.length}\n`);
}

// Merge mainnet transfers into allOnChainTxs (this is the authoritative on-chain set).
for (const [h, v] of txVerification.entries()) {
  if (v.mainnet && v.mainnet.found && v.mainnet.transfers.length > 0) {
    if (!allOnChainTxs.has(h)) allOnChainTxs.set(h, v.mainnet.transfers);
  }
}

// Categorise each purchase by where the tx_hash actually exists on chain.
function actualNetwork(hash) {
  const v = txVerification.get((hash || '').toLowerCase());
  if (!v) return 'orphan';
  if (v.mainnet && v.mainnet.found) return 'base';
  if (v.sepolia && v.sepolia.found) return 'base-sepolia';
  return 'orphan';
}

const realMainnet = [];      // book these
const sepoliaMislabelled = []; // DB says base, tx is on sepolia (data quality issue)
const sepoliaCorrect = [];   // DB says base-sepolia, tx is on sepolia (no issue)
const orphan = [];           // tx doesn't exist on either chain
for (const p of purchases) {
  const actual = actualNetwork(p.tx_hash);
  const labelled = p.network;
  const enriched = { purchase: p, actual_network: actual, labelled_network: labelled };
  if (actual === 'base') {
    realMainnet.push(enriched);
  } else if (actual === 'base-sepolia' && labelled === 'base') {
    sepoliaMislabelled.push(enriched);
  } else if (actual === 'base-sepolia') {
    sepoliaCorrect.push(enriched);
  } else {
    orphan.push(enriched);
  }
}

// For real mainnet purchases, enrich with on-chain transfer detail and payout-leg verification.
for (const m of realMainnet) {
  const p = m.purchase;
  m.onChain = allOnChainTxs.get(p.tx_hash.toLowerCase()) || [];
  const payoutLegs = (p.payout_tx_hashes || '').split('|').map(s => s.trim()).filter(Boolean);
  m.payoutMatches = payoutLegs.map(leg => {
    const [legLabel, legHash] = leg.split(':').map(s => s.trim());
    const v = txVerification.get((legHash || '').toLowerCase());
    const onMainnet = v && v.mainnet && v.mainnet.found;
    const onSepolia = v && v.sepolia && v.sepolia.found;
    return {
      leg: legLabel,
      hash: legHash,
      mainnet: onMainnet,
      sepolia: onSepolia,
      events: onMainnet ? v.mainnet.transfers : [],
    };
  });
}

// Find on-chain mainnet tx that don't correspond to any app_purchases row (or its payout legs).
const purchaseHashes = new Set();
for (const p of purchases) {
  if (p.tx_hash) purchaseHashes.add(p.tx_hash.toLowerCase());
  if (p.payout_tx_hashes) {
    for (const leg of p.payout_tx_hashes.split('|')) {
      const [, h] = leg.split(':').map(s => s.trim());
      if (h) purchaseHashes.add(h.toLowerCase());
    }
  }
}

const unaccountedTxs = [];
for (const [hash, events] of allOnChainTxs.entries()) {
  if (purchaseHashes.has(hash)) continue;
  unaccountedTxs.push({ hash, events });
}

const realMainnetGross = realMainnet.reduce((a, m) => a + Number(m.purchase.amount_usdc), 0);
const sepoliaMislabelledGross = sepoliaMislabelled.reduce((a, m) => a + Number(m.purchase.amount_usdc), 0);
const sepoliaCorrectGross = sepoliaCorrect.reduce((a, m) => a + Number(m.purchase.amount_usdc), 0);
const orphanGross = orphan.reduce((a, m) => a + Number(m.purchase.amount_usdc), 0);

// Build markdown.
let md = `# Wallet Matching Report: Pre-classified Ledger for Colin\n\n`;
md += `Generated ${TODAY}. Source: ${PURCHASES_PATH ? `\`${PURCHASES_PATH}\` (snapshot ${purchasesDoc.snapshotDate})` : 'live Supabase query'}, ${purchases.length} purchase rows. Every \`tx_hash\` and payout-leg hash was verified against BOTH Base mainnet (https://base.blockscout.com) and Base Sepolia (https://base-sepolia.blockscout.com) to determine its actual chain.\n\n`;
md += `**Note on data quality.** The Sepolia testnet rows were removed from \`app_purchases\` on 2026-05-10 (testnet has no accounting value). The \`network\` column for remaining rows was backfilled to match the verified chain. Going forward, the column should be reliable. Orphan rows (tx not found on either chain) are listed in section 5 for manual review.\n\n`;

md += `## 1. Summary by verified chain\n\n`;
md += `| Category | Rows | Gross USDC | Action |\n`;
md += `|----------|-----:|-----------:|--------|\n`;
md += `| Real Base mainnet (book) | ${realMainnet.length} | ${realMainnetGross.toFixed(2)} | Post to Zoho as revenue |\n`;
md += `| Mislabelled (DB=base, actual=Sepolia) | ${sepoliaMislabelled.length} | ${sepoliaMislabelledGross.toFixed(2)} | DO NOT BOOK. Flag for DB correction |\n`;
md += `| Correctly labelled Sepolia | ${sepoliaCorrect.length} | ${sepoliaCorrectGross.toFixed(2)} | DO NOT BOOK. Test data |\n`;
md += `| Orphan (tx not found on either chain) | ${orphan.length} | ${orphanGross.toFixed(2)} | DO NOT BOOK. Investigate with Richard |\n`;
md += `| **Total** | **${purchases.length}** | **${(realMainnetGross + sepoliaMislabelledGross + sepoliaCorrectGross + orphanGross).toFixed(2)}** | |\n\n`;

md += `Real revenue (gross): **${realMainnetGross.toFixed(2)} USDC** across ${realMainnet.length} sales.\n\n`;

md += `## 2. Real mainnet ledger (post these to Zoho)\n\n`;
md += `Each row is a verified Base mainnet sale. Splits sum to amount_usdc. Where split_* columns are null, the legacy contract was used (pre-2026-03-13) and the platform retained 100% (no auto-payout fired).\n\n`;
if (realMainnet.length === 0) {
  md += `None.\n\n`;
} else {
  md += `| Date | Brand | Token | Gross | Brand | Platform | Creator | DB label | Buyer | Sale tx | Payout legs |\n`;
  md += `|------|-------|------:|------:|------:|---------:|--------:|----------|-------|---------|-------------|\n`;
  for (const m of realMainnet) {
    const p = m.purchase;
    const payoutLinks = (m.payoutMatches || []).map(pm => {
      const status = pm.mainnet ? '✓' : (pm.sepolia ? 'sep' : '?');
      return `${pm.leg}:[\`${pm.hash.slice(0,10)}…\`](https://basescan.org/tx/${pm.hash})[${status}]`;
    }).join('<br>') || '_legacy_';
    const dbLabel = m.labelled_network === 'base' ? '`base` ✓' : `\`${m.labelled_network}\` ⚠`;
    md += `| ${p.created_at.slice(0,10)} | ${p.brand_name || '?'} | ${p.token_id} | ${Number(p.amount_usdc).toFixed(2)} | ${p.split_brand_usdc !== null ? Number(p.split_brand_usdc).toFixed(2) : '_legacy_'} | ${p.split_platform_usdc !== null ? Number(p.split_platform_usdc).toFixed(2) : '_legacy_'} | ${p.split_creator_usdc !== null ? Number(p.split_creator_usdc).toFixed(2) : '_legacy_'} | ${dbLabel} | \`${p.buyer_wallet.slice(0,10)}…\` | [\`${p.tx_hash.slice(0,10)}…\`](https://basescan.org/tx/${p.tx_hash}) | ${payoutLinks} |\n`;
  }
  md += `\nLegend: \`base\` ✓ = DB label and verified chain agree. \`base-sepolia\` ⚠ = DB labelled this as test data but the tx is real Base mainnet (under-reports revenue). \`✓\` payout leg verified on mainnet, \`sep\` payout leg actually on Sepolia, \`?\` not found on either chain.\n\n`;
}

md += `## 3. Mislabelled rows: DB says \`base\` but tx is on Sepolia (DO NOT BOOK)\n\n`;
md += `These ${sepoliaMislabelled.length} rows would over-state revenue if Colin trusted the \`network\` column. Treat as test data.\n\n`;
if (sepoliaMislabelled.length === 0) {
  md += `None.\n\n`;
} else {
  md += `| Date | Brand | Token | Gross | Buyer | Sepolia tx |\n|------|-------|------:|------:|-------|------------|\n`;
  for (const m of sepoliaMislabelled) {
    const p = m.purchase;
    md += `| ${p.created_at.slice(0,10)} | ${p.brand_name || '?'} | ${p.token_id} | ${Number(p.amount_usdc).toFixed(2)} | \`${p.buyer_wallet.slice(0,10)}…\` | [\`${p.tx_hash.slice(0,10)}…\`](https://sepolia.basescan.org/tx/${p.tx_hash}) |\n`;
  }
  md += `\n`;
}

md += `## 4. Correctly labelled Sepolia rows (DO NOT BOOK, no issue)\n\n`;
if (sepoliaCorrect.length === 0) {
  md += `None.\n\n`;
} else {
  md += `| Date | Brand | Token | Gross | Sepolia tx |\n|------|-------|------:|------:|------------|\n`;
  for (const m of sepoliaCorrect) {
    const p = m.purchase;
    md += `| ${p.created_at.slice(0,10)} | ${p.brand_name || '?'} | ${p.token_id} | ${Number(p.amount_usdc).toFixed(2)} | [\`${p.tx_hash.slice(0,10)}…\`](https://sepolia.basescan.org/tx/${p.tx_hash}) |\n`;
  }
  md += `\n`;
}

md += `## 5. Orphan rows: tx not found on either chain (DO NOT BOOK, investigate)\n\n`;
md += `These ${orphan.length} rows reference \`tx_hash\` values that don't exist on Base mainnet OR Base Sepolia. Possible causes: tx never confirmed, was reorg'd out, the hash was recorded incorrectly, or Blockscout indexing gap. Investigate before deciding whether to discard the row or reclassify.\n\n`;
if (orphan.length === 0) {
  md += `None.\n\n`;
} else {
  md += `| Date | Brand | Token | Gross | Labelled network | Buyer | Tx hash |\n|------|-------|------:|------:|------------------|-------|---------|\n`;
  for (const m of orphan) {
    const p = m.purchase;
    md += `| ${p.created_at.slice(0,10)} | ${p.brand_name || '?'} | ${p.token_id} | ${Number(p.amount_usdc).toFixed(2)} | ${m.labelled_network} | \`${p.buyer_wallet.slice(0,10)}…\` | \`${p.tx_hash}\` |\n`;
  }
  md += `\n`;
}

md += `\n## 6. Unaccounted on-chain USDC tx (need Richard's classification)\n\n`;
md += `These USDC transfers hit a watched wallet on Base mainnet but do NOT correspond to any \`app_purchases.tx_hash\` or \`payout_tx_hashes\` value. They are top-ups, manual sends, gas rebates, agent micropayments, refunds, or other off-platform activity. Each needs a one-line classification before booking.\n\n`;
md += `| Date | Wallet | Direction | USDC | Counterparty | Tx |\n|------|--------|-----------|-----:|--------------|----|\n`;
const sorted = unaccountedTxs.slice().sort((a, b) => (b.events[0]?.ts || '').localeCompare(a.events[0]?.ts || ''));
for (const u of sorted) {
  for (const e of u.events) {
    if (e.value_usdc === 0) continue;
    md += `| ${e.ts.slice(0, 10)} | ${e.walletLabel} | ${e.direction} | ${e.value_usdc.toFixed(2)} | \`${e.direction === 'IN' ? e.from : e.to}\` | [\`${u.hash.slice(0,10)}…\`](https://basescan.org/tx/${u.hash}) |\n`;
  }
}

md += `\n## 7. Counterparty key\n\n`;
md += `Identities for addresses that recur in the ledger. Treat unknown addresses as external and do not auto-classify them.\n\n`;
md += `| Address | Identity | Source |\n|---------|----------|--------|\n`;
md += `| \`0xbfd71eA27FFc99747dA2873372f84346d9A8b7ed\` | RRG / PLATFORM_WALLET | docs/wallets.md section 1 |\n`;
md += `| \`0x369d04f08f245454926ac96a0164a634fd94660b\` | DEPLOYER (gas signer; also test buyer on 4 mainnet purchases) | docs/wallets.md section 1 + app_purchases |\n`;
md += `| \`0xe653804032A2d51Cc031795afC601B9b1fd2c375\` | DrHobbs personal | docs/wallets.md section 1 + 2 |\n`;
md += `| \`0x58554E8423EF5C10be6fFC82EfABA9149f64de3d\` | VIA Team Wallet | docs/wallets.md section 1 |\n`;
md += `| \`0x61e01997e6a0C692656e94955c67CB3ebcAb8f19\` | East Coast Cassettes pre-handoff | docs/wallets.md section 2 |\n`;
md += `| \`0xc12Ecf02448e0E56DAd9C0D5473553b80d030D75\` | Digital Fashion Week pre-handoff | docs/wallets.md section 2 |\n`;
md += `| \`0xdB59CD2c8F9c6e576510bf7ED294654f41241B65\` | Personal pre-handoff (unbound) | docs/wallets.md section 2 |\n`;
md += `| \`0x2c9a1dadd6cb5425bf0e677fada64a257a558438\` | Artemist (Richard's other test wallet, contact richard@bnv.me) | docs/wallets.md section 3 |\n`;
md += `| \`0xca5c9c4da1787fea491ed6c94e86b04ec46be61d\` | Clooudie brand wallet | docs/wallets.md section 3 |\n`;
md += `| \`0x30b1e8cc377a75d9664c26415a820c4925afa595\` | Frey Tailored brand wallet | docs/wallets.md section 3 |\n`;
md += `| \`0x019d94b9c90abd38f84ebbb488e6c833cdeffc57\` | LIVVIUM brand wallet | docs/wallets.md section 3 |\n`;
md += `| \`0x9eb5405fef682e1d4d555f64a683a499076556a3\` | MYKLÉ brand wallet | docs/wallets.md section 3 |\n`;
md += `| \`0x27daa49fb93445cdb6e3f3a6be7cd6bae1f04e2d\` | Nolo brand wallet | docs/wallets.md section 3 |\n`;
md += `| \`0xb4febbe6c0a0cd350c76054ccfd037d8bf47e502\` | PassportADV brand wallet | docs/wallets.md section 3 |\n`;
md += `| \`0x699e234a877ba075e1f16abb63f895a8a2250388\` | The Year Of... brand wallet | docs/wallets.md section 3 |\n`;
md += `| \`0xe7ed24a6a66170070c725451c003917da83871da\` | Unknown Union brand wallet | docs/wallets.md section 3 |\n`;
md += `| \`0x734a25fB869ab6415b78bbe9a39f1f99dab349E7\` | Shared holding wallet | docs/wallets.md section 4 |\n`;
md += `| \`0x891c13aa323378637404efd971553a3a6df5aaf1\` | Nolo handoff intermediary | docs/wallets.md section 5 |\n`;
md += `| \`0x0e0ef55048fb7b68b06dec7a6413b086a7ec029a\` | Original RRG creator (token 13); also a buyer on 1 mainnet purchase | docs/wallets.md section 5 + app_purchases |\n`;
md += `| \`0xf2e7289889ea5ecc557439a134906f77a1d64b3e\` | Artemist original creator (token 44) | docs/wallets.md section 5 |\n`;
md += `| \`0xf7bba988b1e9f28dcb293ed564b57f965ae1ec2b\` | RRG submission original creator (tokens 12, 19); also a buyer on 1 mainnet purchase | docs/wallets.md section 5 + app_purchases |\n`;
md += `| \`0x9f783931cedc82c538028fb9be5289a38bc395df\` | EOA, holdings exclusively RRG ERC-1155 NFTs across 3 contract versions (live + 2 deprecated). No ETH balance, no other on-chain activity, no ENS / Basename. Pattern matches a sponsored / gasless mint flow (Privy, Coinbase Smart Wallet w/ paymaster, or RRG's own gasless onramp). Originally appeared as buyer for token 17 on 2026-03-08; that row was on Sepolia and deleted in the 2026-05-10 cleanup. **Recommended Zoho:** "External buyer (anonymous EOA, RRG-only history)" if it ever reappears as a mainnet buyer. Confidence: high it's an EOA, low on real-world identity. | Blockscout V2 verified, see [agent investigation](#) |\n`;
md += `| \`0x25B22971892B7314c36EC6DCfB5537500d50Ea35\` | Sepolia test buyer (1 row, 2026-03-16) on a row deleted in the 2026-05-10 cleanup. Treat as external test counterparty if it reappears | app_purchases (Sepolia, since deleted) |\n`;
md += `| \`0xe3478b0BB1A5084567C319096437924948Be1964\` | **MetaMask: Gas Station Swap** (publicly tagged on Etherscan). MetaMask's swap-fee collection EOA, used to skim the ~0.875% MetaMask swap fee from in-app swaps. On-chain profile: 432K+ token transfers received, ~20 tx sent, 47 ETH on Base, ~$3.7M multichain. Confidence: HIGH (Etherscan public name tag is explicit and the activity profile matches a fee-sweeper). The 0.00-0.01 USDC line items in DFW history are MetaMask swap fees, paired in the same tx with the actual swap output. **Recommended Zoho:** "Infrastructure / wallet-provider swap fees (MetaMask)", same category as gas / network fees. Reconcile each fee leg to its parent swap tx, not as standalone vendor payments. | Etherscan public tag + Blockscout activity profile |\n`;

md += `\n## 8. Process for Colin going forward\n\n`;
md += `1. Re-run the snapshot at start of day: in Supabase, execute the SQL in the comment block at the top of \`docs/data/purchases-{DATE}.json\`. Save as today's filename.\n`;
md += `2. \`node scripts/match-purchases.mjs docs/data/purchases-{TODAY}.json\` regenerates this report at \`docs/wallet-matching-{TODAY}.md\`.\n`;
md += `3. Diff section 5 (unaccounted on-chain tx) against the prior day's report. New rows are the tx that need classification today.\n`;
md += `4. Post the new unaccounted rows in #admin asking Richard for classification. Wait for reply before booking.\n`;
md += `5. Sepolia rows (section 4) NEVER post to Zoho.\n`;

writeFileSync(`docs/wallet-matching-${TODAY}.md`, md);
console.log(JSON.stringify({
  realMainnet: realMainnet.length,
  realMainnetGross: realMainnetGross.toFixed(2),
  sepoliaMislabelled: sepoliaMislabelled.length,
  sepoliaMislabelledGross: sepoliaMislabelledGross.toFixed(2),
  sepoliaCorrect: sepoliaCorrect.length,
  sepoliaCorrectGross: sepoliaCorrectGross.toFixed(2),
  orphan: orphan.length,
  orphanGross: orphanGross.toFixed(2),
  unaccountedTxs: unaccountedTxs.length,
}, null, 2));
console.log(`\nWrote docs/wallet-matching-${TODAY}.md`);
