#!/usr/bin/env node
// One-shot Basescan reconciliation pull for the four personal pre-handoff wallets.
// Outputs JSON summary to stdout and a markdown report to docs/wallet-reconciliation-2026-05-10.md.

import { writeFileSync } from 'node:fs';

// Uses Blockscout V2 (https://base.blockscout.com), free public API. No key required.
const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const NINETY_DAYS_AGO = Math.floor(Date.now() / 1000) - 90 * 86400;

const WALLETS = [
  { addr: '0x61e01997e6a0C692656e94955c67CB3ebcAb8f19', label: 'East Coast Cassettes (eastcoast)' },
  { addr: '0xc12Ecf02448e0E56DAd9C0D5473553b80d030D75', label: 'Digital Fashion Week (dfw)' },
  { addr: '0xdB59CD2c8F9c6e576510bf7ED294654f41241B65', label: 'Unbound personal wallet' },
  { addr: '0xe653804032A2d51Cc031795afC601B9b1fd2c375', label: 'DrHobbs personal' },
];

async function fetchJson(url) {
  const r = await fetch(url);
  return r.json();
}

async function paginate(baseUrl) {
  const items = [];
  let url = baseUrl;
  for (let page = 0; page < 20; page++) { // hard cap: 20 pages
    const resp = await fetchJson(url);
    if (!Array.isArray(resp.items)) {
      console.error(`api note: ${JSON.stringify(resp).slice(0,150)}`);
      break;
    }
    items.push(...resp.items);
    if (!resp.next_page_params) break;
    // Early exit: if oldest item in this page is already older than 90 days, stop
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

  // Blockscout returns ALL ERC-20 transfers regardless of ?token query (server filter is partial).
  // Filter client-side by token.address_hash to ignore phishing tokens that spoof USDC name/symbol.
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

  const usdcIn  = usdcTxs.filter(t => t.to.toLowerCase() === w.addr.toLowerCase()).reduce((a, t) => a + Number(t.value) / 1e6, 0);
  const usdcOut = usdcTxs.filter(t => t.from.toLowerCase() === w.addr.toLowerCase()).reduce((a, t) => a + Number(t.value) / 1e6, 0);
  const ethIn   = ethTxs.filter(t => t.to.toLowerCase()   === w.addr.toLowerCase() && t.value !== '0').reduce((a, t) => a + Number(t.value) / 1e18, 0);
  const ethOut  = ethTxs.filter(t => t.from.toLowerCase() === w.addr.toLowerCase() && t.value !== '0').reduce((a, t) => a + Number(t.value) / 1e18, 0);
  const gasSpent = ethTxs.filter(t => t.from.toLowerCase() === w.addr.toLowerCase()).reduce((a, t) => a + (Number(t.gasUsed) * Number(t.gasPrice)) / 1e18, 0);

  return {
    label: w.label,
    addr: w.addr,
    usdc: { in: usdcIn, out: usdcOut, net: usdcIn - usdcOut, count: usdcTxs.length },
    eth:  { in: ethIn,  out: ethOut,  net: ethIn - ethOut,  txCount: ethTxs.length, gasSpent },
    usdcTxs: usdcTxs.map(t => ({
      ts: new Date(Number(t.timeStamp) * 1000).toISOString(),
      hash: t.hash,
      from: t.from,
      to: t.to,
      value_usdc: Number(t.value) / 1e6,
      direction: t.to.toLowerCase() === w.addr.toLowerCase() ? 'IN' : 'OUT',
      counterparty: t.to.toLowerCase() === w.addr.toLowerCase() ? t.from : t.to,
    })),
  };
}

const results = await Promise.all(WALLETS.map(pullWallet));

let md = `# Wallet Reconciliation Report: Personal Pre-Handoff Wallets\n\n`;
md += `Source: Blockscout V2 API (https://base.blockscout.com), Base mainnet (chain 8453). Window: last 90 days (since ${new Date(NINETY_DAYS_AGO * 1000).toISOString().slice(0,10)}). Generated ${new Date().toISOString().slice(0,10)}. USDC contract \`${USDC}\`. Phishing tokens that spoof USDC name/symbol are filtered out by exact contract match.\n\n`;
md += `## Summary\n\n`;
md += `| Wallet | USDC in | USDC out | USDC net | USDC tx | ETH in | ETH out | Gas spent (ETH) |\n`;
md += `|--------|---------|----------|----------|---------|--------|---------|------------------|\n`;
for (const r of results) {
  md += `| ${r.label}<br>\`${r.addr}\` | ${r.usdc.in.toFixed(2)} | ${r.usdc.out.toFixed(2)} | ${r.usdc.net.toFixed(2)} | ${r.usdc.count} | ${r.eth.in.toFixed(6)} | ${r.eth.out.toFixed(6)} | ${r.eth.gasSpent.toFixed(6)} |\n`;
}

md += `\n## USDC transfers (last 90 days, per wallet)\n\n`;
for (const r of results) {
  md += `### ${r.label}: \`${r.addr}\`\n\n`;
  if (r.usdcTxs.length === 0) {
    md += `No USDC transfers in window.\n\n`;
    continue;
  }
  md += `| Date | Direction | Amount USDC | Counterparty | Tx |\n`;
  md += `|------|-----------|-------------|--------------|----|\n`;
  for (const t of r.usdcTxs) {
    md += `| ${t.ts.slice(0,10)} | ${t.direction} | ${t.value_usdc.toFixed(2)} | \`${t.counterparty}\` | [\`${t.hash.slice(0,10)}…\`](https://basescan.org/tx/${t.hash}) |\n`;
  }
  md += `\n`;
}

writeFileSync('docs/wallet-reconciliation-2026-05-10.md', md);
console.log(JSON.stringify(results.map(r => ({ label: r.label, addr: r.addr, usdc: r.usdc, eth: r.eth })), null, 2));
console.log('\nWrote docs/wallet-reconciliation-2026-05-10.md');
