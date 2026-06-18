#!/usr/bin/env node
// PreToolUse guard: refuse `vercel --prod` unless the repo is in a deployable state.
// Prevents deploying from a dirty/unpushed working tree, which can upload untracked
// files and ship around a broken commit (see feedback_deploy_from_clean_pushed_tree).
import { execSync } from 'node:child_process';

function readStdin() {
  try { return execSync('cat', { stdin: 0 }); } catch { return ''; }
}

let raw = '';
try {
  const chunks = [];
  process.stdin.on('data', (c) => chunks.push(c));
  process.stdin.on('end', () => {
    raw = Buffer.concat(chunks).toString('utf8');
    main(raw);
  });
} catch {
  main('');
}

function block(msg) {
  process.stderr.write(msg + '\n');
  process.exit(2); // exit 2 = blocking error for PreToolUse; stderr is fed back to Claude
}

function main(input) {
  let cmd = '';
  try { cmd = (JSON.parse(input || '{}').tool_input || {}).command || ''; } catch { cmd = ''; }

  // Only guard production deploys.
  if (!/vercel\s+--prod/.test(cmd)) process.exit(0);

  const git = (args) => execSync(`git ${args}`, { encoding: 'utf8' }).trim();

  let dirty = '';
  let divergence = '';
  try {
    dirty = git('status --porcelain');
    git('fetch origin --quiet');
    divergence = git('rev-list --left-right --count origin/master...HEAD'); // "<behind>\t<ahead>"
  } catch (e) {
    block('guard-deploy: could not run git checks (' + e.message + '). Resolve before deploying.');
  }

  const problems = [];
  if (dirty) problems.push('Working tree is DIRTY (uncommitted/untracked files). vercel --prod would upload them and can ship around a broken commit.');
  if (divergence && divergence.replace(/\s+/g, ' ') !== '0 0') {
    const [behind, ahead] = divergence.split(/\s+/);
    problems.push(`Local master is out of sync with origin (behind ${behind}, ahead ${ahead}). Push first so the deploy matches the source of record.`);
  }

  if (problems.length) {
    block(
      'BLOCKED: not in a deployable state.\n - ' + problems.join('\n - ') +
      '\n\nRequired before vercel --prod (feedback_deploy_from_clean_pushed_tree):\n' +
      ' 1. Commit everything real code depends on.\n' +
      ' 2. git push origin master.\n' +
      ' 3. Confirm clean tree + 0 0 divergence.\n' +
      ' 4. tsc --noEmit passes.\n' +
      'Deploy only from committed, pushed code.'
    );
  }
  process.exit(0);
}
