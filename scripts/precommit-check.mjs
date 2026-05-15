#!/usr/bin/env node
/**
 * precommit-check.mjs
 *
 * Runs the checks that have caused the most recurring breakage in rrg.
 *
 * ACTIVE CHECKS:
 *
 *   1. Em-dash / en-dash check on user-facing source files. We forbid '—'
 *      (U+2014) and '–' (U+2013) in app/, lib/, and components/ because they
 *      are the single most visible AI tell in copy that reaches brands or
 *      users. Internal docs (.md anywhere in the repo) are exempt; em-dashes
 *      there are fine.
 *
 * DEFERRED CHECKS (intentionally disabled — see below):
 *
 *   2. tsc --noEmit on the whole project would be ideal because CLAUDE.md
 *      global rules require it before any push. It is DISABLED today because
 *      the repo currently reports pre-existing tsc errors:
 *        - components/agent/ChatPanel.tsx: missing react-markdown / remark-gfm
 *          types + several implicit-any errors
 *        - .next/types/validator.ts: auto-generated stale entries
 *      Turning the gate on right now would block every commit. Once those
 *      errors are resolved (separate session), flip RUN_TSC to true.
 *
 * Install: scripts/install-hooks.sh
 * Bypass for genuine emergencies: `git commit --no-verify`
 */
import { execSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";

const RUN_TSC = false; // Flip to true once `npx tsc --noEmit` exits clean.
const FORBIDDEN = /[—–]/; // em-dash, en-dash

function stagedSourceFiles() {
  const out = execSync("git diff --cached --name-only --diff-filter=ACM", {
    encoding: "utf8",
  });
  return out
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .filter((file) => /^(app|lib|components)\//.test(file))
    .filter((file) => /\.(ts|tsx|js|jsx|mjs)$/.test(file));
}

function checkEmDashes(files) {
  const offenders = [];
  for (const file of files) {
    if (!existsSync(file)) continue;
    const text = readFileSync(file, "utf8");
    if (FORBIDDEN.test(text)) {
      const lines = text.split("\n");
      lines.forEach((line, idx) => {
        if (FORBIDDEN.test(line)) {
          offenders.push(`  ${file}:${idx + 1}  ${line.trim().slice(0, 100)}`);
        }
      });
    }
  }
  return offenders;
}

function runTypeCheck() {
  try {
    execSync("npx tsc --noEmit", { stdio: "pipe" });
    return null;
  } catch (e) {
    const stdout = e.stdout ? e.stdout.toString() : "";
    const stderr = e.stderr ? e.stderr.toString() : "";
    return (stdout + stderr).trim();
  }
}

const sourceFiles = stagedSourceFiles();

if (sourceFiles.length > 0) {
  const offenders = checkEmDashes(sourceFiles);
  if (offenders.length > 0) {
    console.error("\n[pre-commit] Em-dash / en-dash found in user-facing source files:");
    console.error(offenders.join("\n"));
    console.error("\nReplace with a full stop, comma, or conjunction. Then re-stage and commit.");
    console.error("If you are certain this is correct (rare), bypass with: git commit --no-verify\n");
    process.exit(1);
  }
}

if (RUN_TSC) {
  const tscError = runTypeCheck();
  if (tscError) {
    console.error("\n[pre-commit] tsc --noEmit failed. Fix the TypeScript errors before committing:\n");
    console.error(tscError);
    console.error("\nIf you absolutely must skip (rare), bypass with: git commit --no-verify\n");
    process.exit(1);
  }
}

console.log(`[pre-commit] Em-dash check passed${RUN_TSC ? " + tsc clean" : " (tsc check deferred)"}.`);
