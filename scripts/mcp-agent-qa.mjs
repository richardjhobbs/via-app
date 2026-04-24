/**
 * scripts/mcp-agent-qa.mjs
 *
 * Agent QA regression runner for the RRG platform MCP.
 *
 * Every onboarded product should be discoverable from the naming clusters
 * a real agent would use. This script calls the live /mcp endpoint with a
 * fixed set of queries and asserts the expected tokenId appears in the
 * top N results. Catches the kind of silent retrievability regression
 * ChatGPT demonstrated in the SG Alaska onboarding session — the data
 * was in the DB, the tool worked on direct calls, but the agent couldn't
 * reach it because the tool surface was missing a primitive.
 *
 * Usage:
 *   node scripts/mcp-agent-qa.mjs                      # run default suite against prod
 *   node scripts/mcp-agent-qa.mjs --endpoint <url>     # run against a different host
 *   node scripts/mcp-agent-qa.mjs --suite <file>       # use a custom suite JSON
 *
 * Suite file shape:
 *   [
 *     { "name": "jordan 1 alaska", "query": "Jordan 1 Alaska", "expectToken": 302, "topN": 3 },
 *     { "name": "alaska size 10.5 price", "query": "Jordan 1 Alaska", "size": "10.5", "expectToken": 302,
 *       "expectSizeAvailable": true, "expectSizePriceUsdc": 770 }
 *   ]
 *
 * Exits 0 if every case passes, 1 if any fails. Prints a per-case result
 * line so CI output is readable.
 */

import { readFileSync } from 'fs';
import { resolve } from 'path';

const args = process.argv.slice(2);
const flag = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i+1] : null; };

const ENDPOINT = flag('--endpoint') ?? 'https://realrealgenuine.com/mcp';
const SUITE_PATH = flag('--suite');

// Default suite — derived from queries shipped products already satisfy.
// Add one new entry per onboarded reseller product so regressions are caught.
const DEFAULT_SUITE = [
  // --- Stadium Goods: Air Jordan 1 Virgil Abloh Archive Alaska (token #302) ---
  { name: 'sg-alaska: canonical',           query: 'Jordan 1 Alaska',                                expectToken: 302, topN: 3 },
  { name: 'sg-alaska: sku dashed',          query: 'AA3834-100',                                     expectToken: 302, topN: 3 },
  { name: 'sg-alaska: sku spaced',          query: 'AA3834 100',                                     expectToken: 302, topN: 3 },
  { name: 'sg-alaska: sku concat',          query: 'AA3834100',                                      expectToken: 302, topN: 3 },
  { name: 'sg-alaska: collab',              query: 'Virgil Abloh Off-White',                         expectToken: 302, topN: 3 },
  { name: 'sg-alaska: alt_name VAA',        query: 'VAA Alaska',                                     expectToken: 302, topN: 3 },
  { name: 'sg-alaska: alt_name The Ten',    query: 'Off-White The Ten',                              expectToken: 302, topN: 3 },
  { name: 'sg-alaska: brand + category',    query: 'Stadium Goods sneakers',                         expectToken: 302, topN: 5 },

  // Size filter cases
  { name: 'sg-alaska: size 10.5 available', query: 'Jordan 1 Alaska', size: '10.5',
    expectToken: 302, expectSizeAvailable: true,  expectSizePriceUsdc: 770 },
  { name: 'sg-alaska: size 4 grail',        query: 'Jordan 1 Alaska', size: '4',
    expectToken: 302, expectSizeAvailable: true,  expectSizePriceUsdc: 1899 },
  { name: 'sg-alaska: size 3.5 grail',      query: 'Jordan 1 Alaska', size: '3.5',
    expectToken: 302, expectSizeAvailable: true,  expectSizePriceUsdc: 1583 },
  { name: 'sg-alaska: size 1 sold out',     query: 'Jordan 1 Alaska', size: '1',
    expectToken: 302, expectSizeAvailable: false },
  { name: 'sg-alaska: size 18 sold out',    query: 'Jordan 1 Alaska', size: '18',
    expectToken: 302, expectSizeAvailable: false },
];

async function callMcp(method, params) {
  const resp = await fetch(ENDPOINT, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  const text = await resp.text();
  // MCP streamable transport returns SSE framing
  const m = text.match(/data: (\{[\s\S]*\})/);
  if (!m) throw new Error(`No SSE data in response: ${text.slice(0, 200)}`);
  const outer = JSON.parse(m[1]);
  if (outer.error) throw new Error(`MCP error: ${JSON.stringify(outer.error)}`);
  const inner = outer.result?.content?.[0]?.text;
  if (!inner) throw new Error(`No result.content[0].text in MCP response`);
  return JSON.parse(inner);
}

async function runCase(c) {
  const args = { query: c.query };
  if (c.size)       args.size = c.size;
  if (c.brand_slug) args.brand_slug = c.brand_slug;
  if (c.topN)       args.limit = Math.max(c.topN, 5);
  else              args.limit = 5;

  let result;
  try {
    result = await callMcp('tools/call', { name: 'search_products', arguments: args });
  } catch (e) {
    return { pass: false, reason: `call failed: ${e.message}` };
  }

  const ids = (result.results ?? []).map(r => r.tokenId);
  const pos = ids.indexOf(c.expectToken);
  const topN = c.topN ?? ids.length;

  if (pos < 0 || pos >= topN) {
    return { pass: false, reason: `expected token ${c.expectToken} in top ${topN}, got [${ids.join(',')}]` };
  }

  const hit = result.results[pos];

  if (c.expectSizeAvailable !== undefined && hit.sizeAvailable !== c.expectSizeAvailable) {
    return { pass: false, reason: `sizeAvailable expected ${c.expectSizeAvailable}, got ${hit.sizeAvailable}` };
  }
  if (c.expectSizePriceUsdc !== undefined && hit.sizePriceUsdc !== c.expectSizePriceUsdc) {
    return { pass: false, reason: `sizePriceUsdc expected ${c.expectSizePriceUsdc}, got ${hit.sizePriceUsdc}` };
  }

  return { pass: true, reason: `token ${c.expectToken} @ rank ${pos + 1}${c.size ? ` size ${c.size} ${hit.sizeAvailable ? 'avail' : 'OOS'}${hit.sizePriceUsdc != null ? ` $${hit.sizePriceUsdc}` : ''}` : ''}` };
}

// ── Main ─────────────────────────────────────────────────────────────
const suite = SUITE_PATH
  ? JSON.parse(readFileSync(resolve(process.cwd(), SUITE_PATH), 'utf8'))
  : DEFAULT_SUITE;

console.log(`──── MCP Agent QA ────`);
console.log(`Endpoint: ${ENDPOINT}`);
console.log(`Cases:    ${suite.length}`);
console.log();

let passed = 0;
let failed = 0;
const fails = [];
for (const c of suite) {
  const { pass, reason } = await runCase(c);
  const mark = pass ? '✓' : '✗';
  console.log(`  ${mark} ${c.name.padEnd(34)} ${reason}`);
  if (pass) passed++; else { failed++; fails.push({ name: c.name, reason }); }
}

console.log();
console.log(`──── Result: ${passed} passed, ${failed} failed ────`);
if (failed > 0) {
  console.log();
  console.log('Failures:');
  for (const f of fails) console.log(`  - ${f.name}: ${f.reason}`);
  process.exit(1);
}
