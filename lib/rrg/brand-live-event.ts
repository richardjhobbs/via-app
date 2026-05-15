/**
 * lib/rrg/brand-live-event.ts
 *
 * Fan-out orchestrator for the moment a brand crosses the Stage-2-complete
 * threshold. Called from app/api/rrg/admin/onboarding-complete/route.ts
 * after the rrg_brands status flip succeeds. Side effects in order:
 *
 *   1. Append a "brand live" entry to the Notion Build Log
 *   2. Regenerate docs/wallets.md from current DB state
 *   3. POST a brief to Priscilla's Discord channel asking her to compose
 *      autopost copy + IG/X drafts
 *   4. POST a brief to Rosie's Discord channel telling her to run the
 *      brand-aware outreach blast to known endpoint agents
 *
 * All four run via Promise.allSettled - any single failure is captured in
 * the returned `results` map; the route continues to surface a 200.
 *
 * Required env:
 *   NOTION_API_KEY                  for the Build Log append
 *   DISCORD_WEBHOOK_PRISCILLA       channel 1482200038896828678
 *   DISCORD_WEBHOOK_ROSIE           channel 1487428316578451576
 *   ADMIN_SECRET                    referenced in Rosie's brief (so she can
 *                                   call /api/rrg/admin/marketing/outreach)
 *   NEXT_PUBLIC_SITE_URL            for storefront URL composition
 */

import { getApprovedDrops } from './db';
import { regenWalletsDoc } from './wallets-doc';
import { appendBrandLiveEntry } from './notion-build-log';
import { sendDiscordBrief, type DiscordEmbed } from './discord-brief';
import { activateBrandConcierge } from './brand-concierge-activation';

const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? 'https://realrealgenuine.com').replace(/\/$/, '');

// Discord embed colours - distinct so each agent's brief is visually
// recognisable in their channel.
const COLOR_PRISCILLA = 0xC026D3; // magenta
const COLOR_ROSIE = 0x059669; // green

export type SideEffectStatus = 'ok' | 'failed' | 'skipped';

export interface BrandLiveResults {
  notion: SideEffectStatus;
  wallets_doc: SideEffectStatus;
  priscilla_discord: SideEffectStatus;
  rosie_discord: SideEffectStatus;
  /** Brand owner login + admin membership so the concierge is reachable. */
  concierge: SideEffectStatus;
  errors: string[];
}

export interface BrandLikeRow {
  id: string;
  slug: string;
  name: string;
  description?: string | null;
  headline?: string | null;
  wallet_address?: string | null;
  // Optional - not every caller will hand these; we'll backfill via DB if missing.
  erc8004_agent_id?: number | null;
}

interface BrandSummary {
  productCount: number;
  tokenMin: number | null;
  tokenMax: number | null;
  topProducts: { tokenId: number; title: string; priceUsdc: string }[];
}

async function summariseBrand(brandId: string): Promise<BrandSummary> {
  const drops = await getApprovedDrops(brandId);
  const visible = drops.filter((d) => d.token_id != null);
  visible.sort((a, b) => (a.token_id ?? 0) - (b.token_id ?? 0));
  const tokens = visible.map((d) => d.token_id!).filter((t) => Number.isFinite(t));
  const topProducts = visible.slice(0, 5).map((d) => ({
    tokenId: d.token_id!,
    title: d.title,
    priceUsdc: parseFloat(d.price_usdc ?? '0').toFixed(2),
  }));
  return {
    productCount: visible.length,
    tokenMin: tokens.length > 0 ? Math.min(...tokens) : null,
    tokenMax: tokens.length > 0 ? Math.max(...tokens) : null,
    topProducts,
  };
}

function priscillaEmbed(brand: BrandLikeRow, summary: BrandSummary): DiscordEmbed {
  const storefront = `${SITE_URL}/brand/${brand.slug}`;
  const mcp = `${SITE_URL}/brand/${brand.slug}/mcp`;
  const blurb = (brand.headline ?? brand.description ?? '').toString().slice(0, 400);
  const productLines = summary.topProducts.length === 0
    ? 'No live products yet. Hold autopost until first listing approves.'
    : summary.topProducts
        .map((p) => `#${p.tokenId} ${p.title} - $${p.priceUsdc} USDC`)
        .join('\n');

  return {
    title: `New brand live: ${brand.name}`,
    url: storefront,
    color: COLOR_PRISCILLA,
    description: blurb || `Stage 2 onboarding complete for ${brand.name}.`,
    fields: [
      { name: 'Slug', value: brand.slug, inline: true },
      {
        name: 'Agent',
        value: brand.erc8004_agent_id != null ? `#${brand.erc8004_agent_id}` : 'unregistered',
        inline: true,
      },
      {
        name: 'Products',
        value: summary.productCount === 0 ? '0' : `${summary.productCount}`,
        inline: true,
      },
      { name: 'Storefront', value: storefront },
      { name: 'Per-brand MCP', value: mcp },
      {
        name: 'Top products',
        value: productLines.slice(0, 1024),
      },
      {
        name: 'Action',
        value: [
          'Compose autopost copy for Bluesky + Telegram + Discord and submit via your `priscilla-broadcast` endpoint.',
          'Draft Instagram and X copy in this channel for Richard to approve before publishing.',
          'Pull the catalogue context from the storefront URL above before drafting.',
        ].join('\n\n'),
      },
    ],
    footer: { text: 'Auto-brief from onboarding-complete. Reply here once posted.' },
  };
}

function rosieEmbed(brand: BrandLikeRow, summary: BrandSummary): DiscordEmbed {
  const storefront = `${SITE_URL}/brand/${brand.slug}`;
  const blurb = (brand.headline ?? brand.description ?? '').toString().slice(0, 400);
  const productLines = summary.topProducts.length === 0
    ? 'No live products yet. Skip outreach until first listing approves.'
    : summary.topProducts
        .map((p) => `#${p.tokenId} ${p.title} - $${p.priceUsdc} USDC`)
        .join('\n');

  const outreachCall = [
    '```',
    'POST https://realrealgenuine.com/api/rrg/admin/marketing/outreach',
    'Header: x-admin-secret: $ADMIN_SECRET',
    'Body: {',
    `  "brand_slug": "${brand.slug}",`,
    '  "tier": "warm",',
    '  "channel": "a2a",',
    '  "limit": 50',
    '}',
    '```',
    'Repeat with `"tier": "hot"`. Reply in this channel with delivered / bounced / failed counts from each batch.',
  ].join('\n');

  const memoryReminder = [
    `Memory TODO for next Claude session:`,
    `- write \`${brand.slug}_storefront.md\` under .claude/projects/.../memory/`,
    '- append the brand to `MEMORY.md` and `storefronts_index.md`',
    '- bump `docs/wallets.md` header date if a manual edit is needed beyond the auto-regen',
  ].join('\n');

  return {
    title: `New brand live: ${brand.name} - run outreach`,
    url: storefront,
    color: COLOR_ROSIE,
    description: blurb || `Stage 2 onboarding complete for ${brand.name}.`,
    fields: [
      { name: 'Slug', value: brand.slug, inline: true },
      {
        name: 'Agent',
        value: brand.erc8004_agent_id != null ? `#${brand.erc8004_agent_id}` : 'unregistered',
        inline: true,
      },
      {
        name: 'Products',
        value: summary.productCount === 0 ? '0' : `${summary.productCount}`,
        inline: true,
      },
      { name: 'Catalogue snapshot', value: productLines.slice(0, 1024) },
      { name: 'Outreach call', value: outreachCall.slice(0, 1024) },
      { name: 'Memory follow-up', value: memoryReminder.slice(0, 1024) },
    ],
    footer: { text: 'Auto-brief from onboarding-complete. Reply with batch counts.' },
  };
}

/**
 * Run all four side effects in parallel. Never throws - collects per-step
 * status into the returned object so the caller can surface it in the
 * response without failing the route.
 */
export async function onBrandLive(brand: BrandLikeRow): Promise<BrandLiveResults> {
  const results: BrandLiveResults = {
    notion: 'skipped',
    wallets_doc: 'skipped',
    priscilla_discord: 'skipped',
    rosie_discord: 'skipped',
    concierge: 'skipped',
    errors: [],
  };

  // Brand summary feeds both Discord briefs and the Notion entry.
  let summary: BrandSummary;
  try {
    summary = await summariseBrand(brand.id);
  } catch (err) {
    summary = { productCount: 0, tokenMin: null, tokenMax: null, topProducts: [] };
    results.errors.push(`summariseBrand: ${err instanceof Error ? err.message : String(err)}`);
  }

  const storefrontUrl = `${SITE_URL}/brand/${brand.slug}`;

  const tasks: Promise<{ key: keyof BrandLiveResults; status: SideEffectStatus; err?: string }>[] = [
    appendBrandLiveEntry({
      slug: brand.slug,
      name: brand.name,
      agentId: brand.erc8004_agent_id ?? null,
      walletAddress: brand.wallet_address ?? null,
      tokenCount: summary.productCount,
      storefrontUrl,
    })
      .then(() => ({ key: 'notion' as const, status: 'ok' as const }))
      .catch((err: unknown) => ({
        key: 'notion' as const,
        status: 'failed' as const,
        err: err instanceof Error ? err.message : String(err),
      })),
    regenWalletsDoc()
      .then(() => ({ key: 'wallets_doc' as const, status: 'ok' as const }))
      .catch((err: unknown) => ({
        key: 'wallets_doc' as const,
        status: 'failed' as const,
        err: err instanceof Error ? err.message : String(err),
      })),
    // Stage-2 automatic concierge activation: give the brand owner a login
    // (auth user + rrg_brand_members admin row) so the concierge admin chat
    // is reachable. Idempotent, no-ops if an admin member already exists.
    activateBrandConcierge({ brandId: brand.id })
      .then((r) => {
        if (r.status === 'activated' || r.status === 'already_active') {
          return { key: 'concierge' as const, status: 'ok' as const };
        }
        return {
          key: 'concierge' as const,
          status: (r.status === 'skipped' ? 'skipped' : 'failed') as SideEffectStatus,
          err: r.error,
        };
      })
      .catch((err: unknown) => ({
        key: 'concierge' as const,
        status: 'failed' as const,
        err: err instanceof Error ? err.message : String(err),
      })),
  ];

  const priscillaWebhook = process.env.DISCORD_WEBHOOK_PRISCILLA;
  if (priscillaWebhook) {
    tasks.push(
      sendDiscordBrief(priscillaWebhook, { embeds: [priscillaEmbed(brand, summary)] })
        .then(() => ({ key: 'priscilla_discord' as const, status: 'ok' as const }))
        .catch((err: unknown) => ({
          key: 'priscilla_discord' as const,
          status: 'failed' as const,
          err: err instanceof Error ? err.message : String(err),
        })),
    );
  } else {
    results.errors.push('priscilla_discord: DISCORD_WEBHOOK_PRISCILLA not set');
  }

  const rosieWebhook = process.env.DISCORD_WEBHOOK_ROSIE;
  if (rosieWebhook) {
    tasks.push(
      sendDiscordBrief(rosieWebhook, { embeds: [rosieEmbed(brand, summary)] })
        .then(() => ({ key: 'rosie_discord' as const, status: 'ok' as const }))
        .catch((err: unknown) => ({
          key: 'rosie_discord' as const,
          status: 'failed' as const,
          err: err instanceof Error ? err.message : String(err),
        })),
    );
  } else {
    results.errors.push('rosie_discord: DISCORD_WEBHOOK_ROSIE not set');
  }

  const settled = await Promise.all(tasks);
  for (const r of settled) {
    if (r.key === 'errors') continue;
    (results as unknown as Record<string, SideEffectStatus>)[r.key] = r.status;
    if (r.err) results.errors.push(`${r.key}: ${r.err}`);
  }

  return results;
}
