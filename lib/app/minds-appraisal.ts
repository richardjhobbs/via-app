/**
 * Import a Minds shopping-preference appraisal into a VIA buying agent.
 *
 * A Minds agent (hellominds.ai) reads the owner's email INSIDE the Mind, appraises
 * how they shop, and pushes the structured result here. VIA never sees the raw
 * email: only the PreferenceAppraisal below crosses the boundary. We map it onto
 * the SAME buyer profile every other surface reads (app_buyer_memories + the
 * delegation caps on app_buyers), so an imported buyer arrives pre-trained.
 *
 * Idempotent by (buyer_id, external_source, external_id) , the unique index added
 * in migration 0029 , so a re-appraisal updates rows in place instead of
 * duplicating. Provenance tag: external_source = 'minds-email'. Modelled on
 * lib/app/rrg-concierge-import.ts.
 *
 * Two kinds of signal come out of an appraisal and they are treated differently:
 *   - TASTE (categories, brands, sizes, cadence) -> soft preference / brand_affinity
 *     / constraint memories. They shape matching and negotiation, they do not gate
 *     autonomous spend.
 *   - BUDGET (a per-item ceiling, a monthly estimate) -> a PROPOSED delegation cap.
 *     Caps gate autonomous spend, so they are never applied automatically: they are
 *     stashed as a private 'proposed_caps' memory and only become live caps when the
 *     owner approves them in the dashboard.
 */
import { z } from 'zod';
import { db } from './db';
import type { BuyerMemoryType } from './buying-agent';

export const EXTERNAL_SOURCE = 'minds-email';
const PROPOSED_CAPS_EXTERNAL_ID = 'appraisal:proposed_caps';

// ── The contract: PreferenceAppraisal (what a Mind pushes to VIA) ──────

export const PreferenceAppraisalSchema = z.object({
  categories: z.array(z.object({
    category:              z.string().min(1).max(60),
    affinity:             z.number().min(0).max(1).optional(),
    typical_price_usd_low:  z.number().min(0).optional(),
    typical_price_usd_high: z.number().min(0).optional(),
  })).max(40).optional().default([]),
  brands_liked:   z.array(z.string().min(1).max(80)).max(60).optional().default([]),
  brands_avoided: z.array(z.string().min(1).max(80)).max(60).optional().default([]),
  sizes:          z.record(z.string(), z.string().max(40)).optional().default({}),
  purchase_cadence: z.enum(['frequent', 'occasional', 'rare']).optional(),
  budget_signal: z.object({
    monthly_spend_usd_estimate: z.number().min(0).optional(),
    single_item_ceiling_usd:    z.number().min(0).optional(),
  }).optional(),
  notable_recent_purchases: z.array(z.object({
    category: z.string().max(60).optional(),
    item:     z.string().max(200).optional(),
    price_usd: z.number().min(0).optional(),
    when:     z.string().max(40).optional(),
  })).max(50).optional().default([]),
  confidence:      z.number().min(0).max(1).optional().default(0.5),
  // Human-readable prose only , NEVER raw quoted email content.
  evidence_summary: z.string().max(4000).optional(),
});

export type PreferenceAppraisal = z.infer<typeof PreferenceAppraisalSchema>;

export interface DelegationCaps {
  max_purchase_usd?: number;
  auto_buy_under_usd?: number;
  categories_allowed?: string[];
  categories_blocked?: string[];
}

// ── Mapping appraisal -> memory rows ──────────────────────────────────

interface MappedMemory {
  type: BuyerMemoryType;
  title: string;
  body: string;
  structured: Record<string, unknown>;
  tags: string[];
  external_id: string;
}

function clampTitle(s: string): string {
  const oneLine = s.replace(/\s+/g, ' ').trim();
  return oneLine.length <= 110 ? oneLine : `${oneLine.slice(0, 107)}...`;
}

/** Conservative caps derived from the budget signal. Only a per-item ceiling
 *  maps to a hard cap; the auto-buy threshold is a small fraction of it and only
 *  when the appraisal is reasonably confident. Categories are intentionally NOT
 *  turned into a hard allow-list (that would over-restrict autonomous buying);
 *  they live as soft preference memories instead. */
export function deriveProposedCaps(a: PreferenceAppraisal): DelegationCaps {
  const caps: DelegationCaps = {};
  const ceiling = a.budget_signal?.single_item_ceiling_usd;
  if (typeof ceiling === 'number' && ceiling > 0) {
    caps.max_purchase_usd = Math.round(ceiling);
    if ((a.confidence ?? 0) >= 0.6) {
      caps.auto_buy_under_usd = Math.max(1, Math.round(ceiling * 0.25));
    }
  }
  return caps;
}

/** Turn the appraisal into stable memory rows (deterministic external_ids so a
 *  later re-import updates them in place rather than duplicating). */
function mapAppraisalMemories(a: PreferenceAppraisal): MappedMemory[] {
  const out: MappedMemory[] = [];

  const cats = (a.categories ?? []).filter((c) => c.category?.trim());
  if (cats.length > 0) {
    const names = cats.map((c) => c.category.trim());
    out.push({
      type: 'preference',
      title: clampTitle(`Shops for: ${names.join(', ')}`),
      body: `Categories this buyer shops, appraised from their email history: ${names.join(', ')}.`,
      structured: { categories: cats },
      tags: ['minds-email'],
      external_id: 'appraisal:categories',
    });
  }

  const liked = (a.brands_liked ?? []).filter((b) => b.trim());
  if (liked.length > 0) {
    out.push({
      type: 'brand_affinity',
      title: clampTitle(`Favours: ${liked.join(', ')}`),
      body: `Brands and makers this buyer favours, from their email history: ${liked.join(', ')}.`,
      structured: { brands: liked, stance: 'favour' },
      tags: ['minds-email'],
      external_id: 'appraisal:brands_liked',
    });
  }

  const avoided = (a.brands_avoided ?? []).filter((b) => b.trim());
  if (avoided.length > 0) {
    out.push({
      type: 'brand_affinity',
      title: clampTitle(`Avoids: ${avoided.join(', ')}`),
      body: `Brands this buyer avoids, from their email history: ${avoided.join(', ')}.`,
      structured: { brands: avoided, stance: 'avoid' },
      tags: ['minds-email'],
      external_id: 'appraisal:brands_avoided',
    });
  }

  const sizeEntries = Object.entries(a.sizes ?? {}).filter(([k, v]) => k.trim() && String(v).trim());
  if (sizeEntries.length > 0) {
    const human = sizeEntries.map(([k, v]) => `${k}: ${v}`).join(', ');
    out.push({
      type: 'constraint',
      title: clampTitle(`Sizes: ${human}`),
      body: `Sizes this buyer takes, from their email history: ${human}.`,
      structured: { sizes: Object.fromEntries(sizeEntries) },
      tags: ['minds-email'],
      external_id: 'appraisal:sizes',
    });
  }

  if (a.purchase_cadence) {
    out.push({
      type: 'general',
      title: `Buys ${a.purchase_cadence}ly`,
      body: `This buyer shops on a ${a.purchase_cadence} cadence, from their email history.`,
      structured: { purchase_cadence: a.purchase_cadence },
      tags: ['minds-email'],
      external_id: 'appraisal:cadence',
    });
  }

  // The budget memory carries figures, so it is PRIVATE: it must never reach a
  // seller agent (get_buyer_preferences strips 'private'-tagged rows), mirroring
  // the rule that exact caps are never put in the negotiation prompt.
  const monthly = a.budget_signal?.monthly_spend_usd_estimate;
  const ceiling = a.budget_signal?.single_item_ceiling_usd;
  if ((typeof monthly === 'number' && monthly > 0) || (typeof ceiling === 'number' && ceiling > 0)) {
    const parts: string[] = [];
    if (typeof ceiling === 'number' && ceiling > 0) parts.push(`a typical per-item ceiling around ${Math.round(ceiling)} USD`);
    if (typeof monthly === 'number' && monthly > 0) parts.push(`an estimated monthly spend around ${Math.round(monthly)} USD`);
    out.push({
      type: 'budget',
      title: clampTitle(`Budget signal: ${parts.join('; ')}`),
      body: `Appraised from email history: ${parts.join(' and ')}. Used to propose delegation caps for the owner to approve.`,
      structured: { monthly_spend_usd_estimate: monthly ?? null, single_item_ceiling_usd: ceiling ?? null },
      tags: ['minds-email', 'private'],
      external_id: 'appraisal:budget',
    });
  }

  const summary = (a.evidence_summary ?? '').trim();
  if (summary.length >= 3) {
    out.push({
      type: 'general',
      title: 'How this buyer shops (appraisal summary)',
      body: summary.slice(0, 2000),
      structured: { confidence: a.confidence ?? null },
      tags: ['minds-email'],
      external_id: 'appraisal:summary',
    });
  }

  // The proposed caps live as a private memory until the owner approves them.
  const caps = deriveProposedCaps(a);
  if (Object.keys(caps).length > 0) {
    out.push({
      type: 'budget',
      title: 'Proposed spending caps (awaiting your approval)',
      body: 'Spending caps proposed from your email appraisal. These do NOT take effect until you approve them in the dashboard.',
      structured: { caps, applied: false, source_confidence: a.confidence ?? null },
      tags: ['minds-email', 'proposed-caps', 'private'],
      external_id: PROPOSED_CAPS_EXTERNAL_ID,
    });
  }

  return out;
}

// ── Idempotent upsert (insert new, update changed; never duplicate) ───

async function upsertMemories(
  buyerId: string,
  mapped: MappedMemory[],
): Promise<{ inserted: number; updated: number }> {
  if (mapped.length === 0) return { inserted: 0, updated: 0 };

  const { data: existingRows } = await db
    .from('app_buyer_memories')
    .select('id, external_id, body, structured')
    .eq('buyer_id', buyerId)
    .eq('external_source', EXTERNAL_SOURCE);

  const existing = new Map<string, { id: string; body: string; structured: unknown }>();
  for (const r of (existingRows ?? []) as Array<{ id: string; external_id: string; body: string; structured: unknown }>) {
    if (r.external_id) existing.set(r.external_id, { id: r.id, body: r.body, structured: r.structured });
  }

  const toInsert: Array<Record<string, unknown>> = [];
  let updated = 0;

  for (const m of mapped) {
    const prior = existing.get(m.external_id);
    if (!prior) {
      toInsert.push({
        buyer_id:        buyerId,
        type:            m.type,
        title:           m.title,
        body:            m.body,
        structured:      m.structured,
        tags:            m.tags,
        active:          true,
        external_source: EXTERNAL_SOURCE,
        external_id:     m.external_id,
      });
    } else {
      const changed =
        prior.body !== m.body ||
        JSON.stringify(prior.structured ?? {}) !== JSON.stringify(m.structured ?? {});
      if (changed) {
        const { error } = await db
          .from('app_buyer_memories')
          .update({ type: m.type, title: m.title, body: m.body, structured: m.structured, tags: m.tags, active: true })
          .eq('id', prior.id);
        if (!error) updated++;
      }
    }
  }

  let inserted = 0;
  if (toInsert.length > 0) {
    const { data, error } = await db.from('app_buyer_memories').insert(toInsert).select('id');
    if (error) throw new Error(`memory insert failed: ${error.message}`);
    inserted = data?.length ?? 0;
  }

  return { inserted, updated };
}

// ── Public entry ──────────────────────────────────────────────────────

export interface ImportAppraisalResult {
  inserted: number;
  updated: number;
  proposedCaps: DelegationCaps;
}

/**
 * Import an appraisal onto a buyer. Upserts the taste/budget memories and stashes
 * the proposed caps (the owner approves them separately). Idempotent.
 */
export async function importPreferenceAppraisal(
  buyerId: string,
  appraisal: PreferenceAppraisal,
): Promise<ImportAppraisalResult> {
  const mapped = mapAppraisalMemories(appraisal);
  const counts = await upsertMemories(buyerId, mapped);
  return { ...counts, proposedCaps: deriveProposedCaps(appraisal) };
}

// ── Owner review surface helpers ──────────────────────────────────────

export interface AppraisalReviewMemory {
  id: string;
  type: string;
  title: string;
  body: string;
  tags: string[];
  external_id: string | null;
}

export interface AppraisalReview {
  imported: AppraisalReviewMemory[];
  proposed_caps: DelegationCaps | null;
  proposed_caps_applied: boolean;
  live_caps: DelegationCaps;
}

/** Load the Mind-imported memories + the proposed/live caps for the owner to review. */
export async function getAppraisalReview(buyerId: string): Promise<AppraisalReview> {
  const [{ data: memRows }, { data: buyerRow }] = await Promise.all([
    db.from('app_buyer_memories')
      .select('id, type, title, body, tags, structured, external_id, active')
      .eq('buyer_id', buyerId)
      .eq('external_source', EXTERNAL_SOURCE)
      .eq('active', true),
    db.from('app_buyers').select('delegation_caps').eq('id', buyerId).maybeSingle(),
  ]);

  const rows = (memRows ?? []) as Array<Record<string, unknown>>;
  const imported: AppraisalReviewMemory[] = [];
  let proposed: DelegationCaps | null = null;
  let proposedApplied = false;

  for (const r of rows) {
    if (r.external_id === PROPOSED_CAPS_EXTERNAL_ID) {
      const structured = (r.structured ?? {}) as Record<string, unknown>;
      proposed = (structured.caps ?? null) as DelegationCaps | null;
      proposedApplied = structured.applied === true;
      continue; // not shown in the plain memory list
    }
    imported.push({
      id: String(r.id),
      type: String(r.type),
      title: String(r.title),
      body: String(r.body),
      tags: Array.isArray(r.tags) ? (r.tags as string[]) : [],
      external_id: r.external_id ? String(r.external_id) : null,
    });
  }

  return {
    imported,
    proposed_caps: proposed,
    proposed_caps_applied: proposedApplied,
    live_caps: ((buyerRow?.delegation_caps ?? {}) as DelegationCaps),
  };
}

/**
 * Approve the proposed caps: merge them into the buyer's live delegation_caps and
 * mark the proposal applied. Returns the new live caps, or null if there was no
 * pending proposal.
 */
export async function approveProposedCaps(buyerId: string): Promise<DelegationCaps | null> {
  const { data: capsMem } = await db
    .from('app_buyer_memories')
    .select('id, structured')
    .eq('buyer_id', buyerId)
    .eq('external_source', EXTERNAL_SOURCE)
    .eq('external_id', PROPOSED_CAPS_EXTERNAL_ID)
    .eq('active', true)
    .maybeSingle();
  if (!capsMem) return null;

  const structured = (capsMem.structured ?? {}) as Record<string, unknown>;
  const proposed = (structured.caps ?? {}) as DelegationCaps;
  if (Object.keys(proposed).length === 0) return null;

  const { data: buyerRow } = await db
    .from('app_buyers')
    .select('delegation_caps')
    .eq('id', buyerId)
    .maybeSingle();
  const live = ((buyerRow?.delegation_caps ?? {}) as DelegationCaps);

  const merged: DelegationCaps = { ...live, ...proposed };

  const { error: updErr } = await db
    .from('app_buyers')
    .update({ delegation_caps: merged })
    .eq('id', buyerId);
  if (updErr) throw new Error(`failed to apply caps: ${updErr.message}`);

  await db
    .from('app_buyer_memories')
    .update({
      structured: { ...structured, applied: true },
      title: 'Spending caps (approved from email appraisal)',
      body: 'Spending caps approved by the owner from the Minds email appraisal and now live on this buying agent.',
    })
    .eq('id', capsMem.id as string);

  return merged;
}

/** Reject the proposed caps: deactivate the proposal without touching live caps. */
export async function rejectProposedCaps(buyerId: string): Promise<boolean> {
  const { data } = await db
    .from('app_buyer_memories')
    .update({ active: false })
    .eq('buyer_id', buyerId)
    .eq('external_source', EXTERNAL_SOURCE)
    .eq('external_id', PROPOSED_CAPS_EXTERNAL_ID)
    .eq('active', true)
    .select('id');
  return Array.isArray(data) && data.length > 0;
}
