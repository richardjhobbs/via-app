/**
 * scripts/ci-audit-check.mjs
 *
 * Guardrail B — CI gate.
 *
 * Runs scripts/audit-onchain-creator.mjs against production state, then
 * exits non-zero if any brand has on-chain drops registered with the
 * wrong creator. Wired into .github/workflows/deploy.yml so a deploy
 * cannot ship if the chain state doesn't match the off-chain split intent.
 *
 * Background: see memory/feedback_register_drop_creator_must_be_platform.md.
 */
import { spawnSync } from 'child_process';
import { readFileSync, mkdirSync } from 'fs';
import { resolve } from 'path';

const REPORT_PATH = resolve(process.cwd(), 'tmp', `ci-audit-${Date.now()}.json`);
mkdirSync(resolve(process.cwd(), 'tmp'), { recursive: true });

console.log('──── CI: on-chain creator audit ────');
const result = spawnSync('node', ['scripts/audit-onchain-creator.mjs', '--report-path', REPORT_PATH], {
  stdio: 'inherit',
  cwd: process.cwd(),
});

if (result.status !== 0) {
  console.error(`\nFATAL: audit script exited with code ${result.status}. Failing CI.`);
  process.exit(1);
}

let report;
try {
  report = JSON.parse(readFileSync(REPORT_PATH, 'utf8'));
} catch (e) {
  console.error('FATAL: could not read audit report:', e.message);
  process.exit(1);
}

if (!Number.isInteger(report.wrong)) {
  console.error('FATAL: audit report missing `wrong` count. Schema change?');
  process.exit(1);
}

if (report.wrong > 0) {
  const bad = Object.entries(report.by_brand)
    .filter(([, v]) => v.wrong > 0)
    .sort((a, b) => b[1].wrong - a[1].wrong)
    .map(([s, v]) => `${s}=${v.wrong}`)
    .join(', ');
  console.error('');
  console.error('╔══════════════════════════════════════════════════════════════════════╗');
  console.error('║  DEPLOY BLOCKED — on-chain creator audit failed                      ║');
  console.error('╠══════════════════════════════════════════════════════════════════════╣');
  console.error(`║  ${report.wrong} brand-owned drops have on-chain creator != PLATFORM_WALLET`);
  console.error(`║  Brands: ${bad}`);
  console.error('║  Run scripts/repair-onchain-creator.mjs to remediate before deploy.  ║');
  console.error('║  Reference: memory/feedback_register_drop_creator_must_be_platform.md║');
  console.error('╚══════════════════════════════════════════════════════════════════════╝');
  process.exit(1);
}

console.log(`✓ CI audit pass: ${report.correct} correct, ${report.wrong} wrong, ${report.paused} paused, ${report.unregistered} unregistered.`);
