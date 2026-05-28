/**
 * Rule parser for Basic agents.
 *
 * Converts free-text instructions into a structured AgentRules object.
 * Rules are applied deterministically — no LLM needed.
 */

import type { AgentRules, DropListing } from './types';
import { EMPTY_RULES } from './types';

// ── Parse free text → structured rules ───────────────────────────────

export function parseInstructions(text: string | null): AgentRules {
  if (!text || !text.trim()) return { ...EMPTY_RULES };

  const rules: AgentRules = { ...EMPTY_RULES };
  const lower = text.toLowerCase();
  const lines = lower
    .split(/[.,;\n]+/)
    .map((l) => l.trim())
    .filter(Boolean);

  for (const line of lines) {
    // Price limits
    const maxMatch = line.match(
      /(?:never|don'?t|no|max|under|below|less than|at most).*?\$?(\d+(?:\.\d+)?)/
    );
    if (maxMatch && /(?:bid|spend|pay|over|above|more)/.test(line) === false) {
      rules.maxPriceUsdc = parseFloat(maxMatch[1]);
    }
    const overMatch = line.match(
      /(?:never|don'?t|no).*?(?:bid|spend|pay).*?(?:over|above|more than)\s*\$?(\d+(?:\.\d+)?)/
    );
    if (overMatch) {
      rules.maxPriceUsdc = parseFloat(overMatch[1]);
    }
    const minMatch = line.match(
      /(?:nothing|no|min|above|at least).*?\$?(\d+(?:\.\d+)?)/
    );
    if (minMatch && /(?:under|below)/.test(line)) {
      rules.minPriceUsdc = parseFloat(minMatch[1]);
    }

    // "only X" patterns → whitelist
    const onlyMatch = line.match(/^only\s+(.+)/);
    if (onlyMatch) {
      const items = splitItems(onlyMatch[1]);
      // Guess if brand or tag based on capitalisation in original text
      rules.tagWhitelist.push(...items);
    }

    // "skip/avoid/no X" patterns → blacklist
    const skipMatch = line.match(/(?:skip|avoid|no|never|exclude)\s+(.+)/);
    if (skipMatch) {
      const items = splitItems(skipMatch[1]);
      if (/brand/.test(line)) {
        rules.brandBlacklist.push(...items);
      } else {
        rules.tagBlacklist.push(...items);
      }
    }

    // "prefer/prioritise X" patterns → keywords
    const preferMatch = line.match(/(?:prefer|prioriti[sz]e|focus on|love)\s+(.+)/);
    if (preferMatch) {
      rules.keywords.push(...splitItems(preferMatch[1]));
    }
  }

  return rules;
}

function splitItems(text: string): string[] {
  return text
    .replace(/\band\b/g, ',')
    .split(/[,]+/)
    .map((s) => s.trim().replace(/^(?:anything\s+)?(?:from\s+)?/, ''))
    .filter(Boolean);
}

// ── Evaluate a drop against rules ────────────────────────────────────

export interface RuleResult {
  pass: boolean;
  matched: string[];
  failed: string[];
}

export function evaluateRules(
  rules: AgentRules,
  drop: DropListing,
  sellerName?: string
): RuleResult {
  const matched: string[] = [];
  const failed: string[] = [];

  // Price ceiling
  if (rules.maxPriceUsdc !== null && drop.reserve_price_usdc > rules.maxPriceUsdc) {
    failed.push(`Reserve $${drop.reserve_price_usdc} exceeds max $${rules.maxPriceUsdc}`);
  } else if (rules.maxPriceUsdc !== null) {
    matched.push(`Price within ceiling ($${rules.maxPriceUsdc})`);
  }

  // Price floor
  if (rules.minPriceUsdc !== null && drop.reserve_price_usdc < rules.minPriceUsdc) {
    failed.push(`Reserve $${drop.reserve_price_usdc} below min $${rules.minPriceUsdc}`);
  }

  // Tag whitelist
  if (rules.tagWhitelist.length > 0) {
    const dropText = `${drop.title} ${drop.description ?? ''}`.toLowerCase();
    const tagHit = rules.tagWhitelist.some((t) => dropText.includes(t));
    if (tagHit) {
      matched.push('Tag whitelist match');
    } else {
      failed.push(`No tag whitelist match (wanted: ${rules.tagWhitelist.join(', ')})`);
    }
  }

  // Tag blacklist
  if (rules.tagBlacklist.length > 0) {
    const dropText = `${drop.title} ${drop.description ?? ''}`.toLowerCase();
    const blackHit = rules.tagBlacklist.find((t) => dropText.includes(t));
    if (blackHit) {
      failed.push(`Blacklisted tag found: ${blackHit}`);
    }
  }

  // Brand whitelist
  if (rules.brandWhitelist.length > 0 && sellerName) {
    if (rules.brandWhitelist.some((b) => sellerName.toLowerCase().includes(b))) {
      matched.push('Brand whitelist match');
    } else {
      failed.push('Brand not in whitelist');
    }
  }

  // Brand blacklist
  if (rules.brandBlacklist.length > 0 && sellerName) {
    if (rules.brandBlacklist.some((b) => sellerName.toLowerCase().includes(b))) {
      failed.push(`Blacklisted brand: ${sellerName}`);
    }
  }

  // Keyword preference (positive signal, not blocking)
  if (rules.keywords.length > 0) {
    const dropText = `${drop.title} ${drop.description ?? ''}`.toLowerCase();
    const kwHit = rules.keywords.filter((k) => dropText.includes(k));
    if (kwHit.length > 0) {
      matched.push(`Keyword match: ${kwHit.join(', ')}`);
    }
  }

  return {
    pass: failed.length === 0,
    matched,
    failed,
  };
}

// ── Calculate bid amount for Basic agent ─────────────────────────────

export function calculateBidAmount(
  aggression: 'conservative' | 'balanced' | 'aggressive',
  reservePrice: number,
  ceilingPrice: number | null,
  budgetCeiling: number | null
): number {
  const effectiveCeiling = Math.min(
    ceilingPrice ?? Infinity,
    budgetCeiling ?? Infinity
  );

  switch (aggression) {
    case 'conservative':
      // Bid at reserve price (or just above)
      return Math.min(reservePrice, effectiveCeiling);
    case 'balanced':
      // Bid at midpoint between reserve and ceiling
      if (effectiveCeiling === Infinity) return reservePrice;
      return Math.min(
        reservePrice + (effectiveCeiling - reservePrice) * 0.5,
        effectiveCeiling
      );
    case 'aggressive':
      // Bid at ceiling
      if (effectiveCeiling === Infinity) return reservePrice;
      return effectiveCeiling;
  }
}
