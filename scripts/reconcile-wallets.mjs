#!/usr/bin/env node
// Blockscout reconciliation pull for every wallet in the register (docs/wallets.md).
// Outputs a JSON dump to stdout and a markdown report to docs/wallet-reconciliation-{TODAY}.md.
//
// No env required. Uses Blockscout V2 (https://base.blockscout.com), which is free and key-less.
// Pagination stops once the oldest item on a page is older than 90 days (early exit).

import { writeFileSync } from 'node:fs';

const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const NINETY_DAYS_AGO = Math.floor(Date.now() / 1000) - 90 * 86400;
const TODAY = new Date().toISOString().slice(0, 10);

const WALLETS = [
  // Section 1: Core operating
  { group: 'Core operating', label: 'RRG / PLATFORM_WALLET',         addr: '0xbfd71eA27FFc99747dA2873372f84346d9A8b7ed' },
  { group: 'Core operating', label: 'DEPLOYER',                      addr: '0x369d04f08f245454926ac96a0164a634fd94660b' },
  { group: 'Core operating', label: 'VIA Team Wallet',               addr: '0x58554E8423EF5C10be6fFC82EfABA9149f64de3d' },
  { group: 'Core operating', label: 'DrHobbs (also pre-handoff #4)', addr: '0xe653804032A2d51Cc031795afC601B9b1fd2c375' },

  // Section 2: Personal pre-handoff (DrHobbs already covered above)
  { group: 'Personal pre-handoff', label: 'East Coast Cassettes (eastcoast)', addr: '0x61e01997e6a0C692656e94955c67CB3ebcAb8f19' },
  { group: 'Personal pre-handoff', label: 'Digital Fashion Week (dfw)',       addr: '0xc12Ecf02448e0E56DAd9C0D5473553b80d030D75' },
  { group: 'Personal pre-handoff', label: 'Unbound personal wallet',          addr: '0xdB59CD2c8F9c6e576510bf7ED294654f41241B65' },

  // Section 3: Brand-owned (handed off, brand controls funds)
  { group: 'Brand-owned',  label: 'Artemist',       addr: '0x2c9a1dadd6cb5425bf0e677fada64a257a558438' },
  { group: 'Brand-owned',  label: 'Clooudie',       addr: '0xca5c9c4da1787fea491ed6c94e86b04ec46be61d' },
  { group: 'Brand-owned',  label: 'Frey Tailored',  addr: '0x30b1e8cc377a75d9664c26415a820c4925afa595' },
  { group: 'Brand-owned',  label: 'LIVVIUM',        addr: '0x019d94b9c90abd38f84ebbb488e6c833cdeffc57' },
  { group: 'Brand-owned',  label: 'MYKLÉ',          addr: '0x9eb5405fef682e1d4d555f64a683a499076556a3' },
  { group: 'Brand-owned',  label: 'Nolo',           addr: '0x27daa49fb93445cdb6e3f3a6be7cd6bae1f04e2d' },
  { group: 'Brand-owned',  label: 'PassportADV',    addr: '0xb4febbe6c0a0cd350c76054ccfd037d8bf47e502' },
  { group: 'Brand-owned',  label: 'The Year Of...', addr: '0x699e234a877ba075e1f16abb63f895a8a2250388' },
  { group: 'Brand-owned',  label: 'Unknown Union',  addr: '0xe7ed24a6a66170070c725451c003917da83871da' },

  // Section 4: Shared holding wallet
  { group: 'Holding (shared)', label: 'RRG Test Brands holding', addr: '0x734a25fB869ab6415b78bbe9a39f1f99dab349E7' },

  // Section 5: Other historic on-chain creators (no current brand binding)
  { group: 'Historic creators', label: 'Original RRG creator (token 13)',                addr: '0x0e0ef55048fb7b68b06dec7a6413b086a7ec029a' },
  { group: 'Historic creators', label: 'Nolo handoff intermediary (tokens 568-570)',     addr: '0x891c13aa323378637404efd971553a3a6df5aaf1' },
  { group: 'Historic creators', label: 'Artemist original creator (token 44)',           addr: '0xf2e7289889ea5ecc557439a134906f77a1d64b3e' },
  { group: 'Historic creators', label: 'RRG submission original creator (tokens 12,19)', addr: '0xf7bba988b1e9f28dcb293ed564b57f965ae1ec2b' },
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
    if (!Array.isArray(resp.items)) {
      console.error(`api note: ${JSON.stringify(resp).slice(0, 150)}`);
      break;
    }
    items.push(...resp.items);
    if (!resp.next_page_params) break;
    const last = resp.items[resp.items.length - 1];
    if (last && last.timestamp && Math.floor(new Date(last.timestamp).getTime() / 1000) < NINETY_DAYS_AGO) break;
    const qs = new URLSearchParams(resp.next_page_params).toString();
    url = `${baseUrl}${baseUrl.includes('?') ? '&' : '?'}${qs}`;
  }
  return items;
}

async function pullWallet(w) {
  const [usdcRawAll, ethRawAll] = await Promise.all([
    paginate(`https://base.blockscout.com/api/v2/addresses/${w.addr}/token-transfers?type=ERC-20`),
    paginate(`https://base.blockscout.com/api/v2/addresses/${w.addr}/transactions`),
  ]);

  const usdcRaw = usdcRawAll
    .filter(t => t.token && t.token.address_hash && t.token.address_hash.toLowerCase() === USDC.toLowerCase())
    .map(t => ({
      timeStamp: Math.floor(new Date(t.timestamp).getTime() / 1000),
      hash: t.transaction_hash,
      from: (t.from && t.from.hash) || '',
      to: (t.to && t.to.hash) || '',
      value: t.total && t.total.value ? t.total.value : '0',
    }));

  const ethRaw = ethRawAll.map(t => ({
    timeStamp: Math.floor(new Date(t.timestamp).getTime() / 1000),
    hash: t.hash,
    from: (t.from && t.from.hash) || '',
    to: (t.to && t.to.hash) || '',
    value: t.value || '0',
    gasUsed: t.gas_used || '0',
    gasPrice: t.gas_price || '0',
  }));

  const usdcTxs = usdcRaw.filter(t => t.timeStamp >= NINETY_DAYS_AGO);
  const ethTxs  = ethRaw.filter(t => t.timeStamp >= NINETY_DAYS_AGO);

  const usdcIn   = usdcTxs.filter(t => t.to.toLowerCase()   === w.addr.toLowerCase()).reduce((a, t) => a + Number(t.value) / 1e6, 0);
  const usdcOut  = usdcTxs.filter(t => t.from.toLowerCase() === w.addr.toLowerCase()).reduce((a, t) => a + Number(t.value) / 1e6, 0);
  const ethIn    = ethTxs.filter(t => t.to.toLowerCase()    === w.addr.toLowerCase() && t.value !== '0').reduce((a, t) => a + Number(t.value) / 1e18, 0);
  const ethOut   = ethTxs.filter(t => t.from.toLowerCase()  === w.addr.toLowerCase() && t.value !== '0').reduce((a, t) => a + Number(t.value) / 1e18, 0);
  const gasSpent = ethTxs.filter(t => t.from.toLowerCase()  === w.addr.toLowerCase()).reduce((a, t) => a + (Number(t.gasUsed) * Number(t.gasPrice)) / 1e18, 0);

  return {
    group: w.group,
    label: w.label,
    addr: w.addr,
    usdc: { in: usdcIn, out: usdcOut, net: usdcIn - usdcOut, count: usdcTxs.length },
    eth:  { in: ethIn,  out: ethOut,  net: ethIn - ethOut,   txCount: ethTxs.length, gasSpent },
    usdcTxs: usdcTxs.map(t => ({
      ts: new Date(t.timeStamp * 1000).toISOString(),
      hash: t.hash,
      direction: t.to.toLowerCase() === w.addr.toLowerCase() ? 'IN' : 'OUT',
      counterparty: t.to.toLowerCase() === w.addr.toLowerCase() ? t.from : t.to,
      value_usdc: Number(t.value) / 1e6,
    })),
  };
}

async function runChunked(items, size, fn) {
  const out = [];
  for (let i = 0; i < items.length; i += size) {
    const chunk = items.slice(i, i + size);
    const results = await Promise.all(chunk.map(fn));
    out.push(...results);
    process.stderr.write(`  pulled ${out.length}/${items.length}\n`);
  }
  return out;
}

console.error(`Pulling Blockscout data for ${WALLETS.length} wallets, 90-day window since ${new Date(NINETY_DAYS_AGO * 1000).toISOString().slice(0, 10)}...`);
const results = await runChunked(WALLETS, 4, pullWallet);

const groups = [...new Set(WALLETS.map(w => w.group))];

let md = `# Wallet Reconciliation Report: All Registered Wallets\n\n`;
md += `Source: Blockscout V2 API (https://base.blockscout.com), Base mainnet (chain 8453). Window: last 90 days (since ${new Date(NINETY_DAYS_AGO * 1000).toISOString().slice(0, 10)}). Generated ${TODAY}. USDC contract \`${USDC}\`. Phishing tokens that spoof USDC name and symbol are filtered out by exact contract match.\n\n`;
md += `Wallets covered: ${WALLETS.length}. Groups: ${groups.join(', ')}.\n\n`;

md += `## Master summary\n\n`;
md += `| Group | Wallet | Address | USDC in | USDC out | USDC net | Tx | Gas (ETH) |\n`;
md += `|-------|--------|---------|--------:|---------:|---------:|---:|----------:|\n`;
for (const r of results) {
  md += `| ${r.group} | ${r.label} | \`${r.addr}\` | ${r.usdc.in.toFixed(2)} | ${r.usdc.out.toFixed(2)} | ${r.usdc.net.toFixed(2)} | ${r.usdc.count} | ${r.eth.gasSpent.toFixed(6)} |\n`;
}

md += `\n## Group totals\n\n`;
md += `| Group | Wallets | USDC in | USDC out | USDC net | Total tx | Total gas (ETH) |\n`;
md += `|-------|--------:|--------:|---------:|---------:|---------:|----------------:|\n`;
for (const g of groups) {
  const rs = results.filter(r => r.group === g);
  const tin  = rs.reduce((a, r) => a + r.usdc.in,  0);
  const tout = rs.reduce((a, r) => a + r.usdc.out, 0);
  const ttx  = rs.reduce((a, r) => a + r.usdc.count, 0);
  const tgas = rs.reduce((a, r) => a + r.eth.gasSpent, 0);
  md += `| ${g} | ${rs.length} | ${tin.toFixed(2)} | ${tout.toFixed(2)} | ${(tin - tout).toFixed(2)} | ${ttx} | ${tgas.toFixed(6)} |\n`;
}

md += `\n## USDC transfer detail (per wallet, last 90 days)\n\n`;
md += `Tx tables omit zero-value spam (filter applied: \`value_usdc > 0\`). Counterparty is the other side of the transfer relative to the wallet.\n\n`;
for (const g of groups) {
  md += `### Group: ${g}\n\n`;
  for (const r of results.filter(rr => rr.group === g)) {
    md += `#### ${r.label}: \`${r.addr}\`\n\n`;
    const real = r.usdcTxs.filter(t => t.value_usdc > 0);
    if (real.length === 0) {
      md += `No non-zero USDC transfers in window. Total tx count including zero-value: ${r.usdcTxs.length}.\n\n`;
      continue;
    }
    md += `Non-zero tx: ${real.length} of ${r.usdcTxs.length} total. USDC net: ${r.usdc.net.toFixed(2)}.\n\n`;
    md += `| Date | Direction | USDC | Counterparty | Tx |\n`;
    md += `|------|-----------|-----:|--------------|----|\n`;
    for (const t of real) {
      md += `| ${t.ts.slice(0, 10)} | ${t.direction} | ${t.value_usdc.toFixed(2)} | \`${t.counterparty}\` | [\`${t.hash.slice(0, 10)}…\`](https://basescan.org/tx/${t.hash}) |\n`;
    }
    md += `\n`;
  }
}

const outPath = `docs/wallet-reconciliation-${TODAY}.md`;
writeFileSync(outPath, md);
console.log(JSON.stringify(results.map(r => ({ group: r.group, label: r.label, addr: r.addr, usdc: r.usdc, eth: r.eth })), null, 2));
console.log(`\nWrote ${outPath}`);
