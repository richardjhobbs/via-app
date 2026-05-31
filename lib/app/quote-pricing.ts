/**
 * Generic configure-price-quote (CPQ) engine.
 *
 * This is the vertical-agnostic core of agent-to-agent negotiation. A seller
 * whose price is a function of a configuration (a custom printer: garment x
 * print method x locations x quantity x deadline, but equally custom
 * furniture, catering, tiered software, freight, consulting scope) describes
 * the option space ONCE as an OfferingSchema, stored on
 * app_seller_products.option_schema. A buying agent submits Selections; this
 * module validates them against the schema and computes a deterministic total
 * with a line-item breakdown. No vertical is baked in here: apparel is just
 * one set of schema data.
 *
 * The number this produces is ADVISORY. It is the seller's own rule applied,
 * never invented. Nothing is binding until the human seller approves the quote
 * (see app/api/seller/[sellerId]/quotes/[quoteId]/decision).
 *
 * Money is carried in major USDC units (e.g. 12.5 = 12.50 USDC) as plain
 * numbers, rounded to 6 decimals at the boundary. This mirrors the
 * numeric(18,6) columns on app_seller_quotes and computeShippingQuote's
 * costUsd convention in lib/app/shipping.ts.
 */

// ── Schema types (shape of app_seller_products.option_schema) ─────────

export type OptionType = 'single_select' | 'multi_select' | 'numeric' | 'boolean' | 'text';

export interface OptionChoice {
  key:         string;
  label:       string;
  /** USDC added to the per-item price when this choice is selected. */
  price_delta?: number;
}

export interface OptionGroup {
  key:      string;
  label:    string;
  type:     OptionType;
  required?: boolean;
  /** For single_select / multi_select. */
  choices?:  OptionChoice[];
  /**
   * For multi_select: this many selections are included at no extra cost;
   * each additional selection is charged its own price_delta. Default 0
   * (every selection is priced).
   */
  included_count?: number;
  /** For numeric: USDC added per unit of the supplied numeric value. */
  price_per_unit?: number;
  min?: number;
  max?: number;
}

export interface QuantitySpec {
  min?: number;
  max?: number;
  /**
   * Volume tiers. The highest tier whose min_qty is met applies its
   * unit_multiplier to the per-item price (e.g. 0.9 = 10% off per unit at
   * volume). Tiers may be listed in any order.
   */
  tiers?: { min_qty: number; unit_multiplier: number }[];
}

export interface Modifier {
  /** Boolean group key that toggles this modifier (e.g. 'rush'). */
  key:    string;
  label:  string;
  type:   'pct' | 'flat';
  /** Percent surcharge (type 'pct', e.g. 25 = +25%) or flat USDC (type 'flat'). */
  amount: number;
}

export interface OfferingSchema {
  currency:    string;          // 'USDC'
  base_price:  number;          // per-item starting price before any options
  groups:      OptionGroup[];
  quantity?:   QuantitySpec;
  modifiers?:  Modifier[];
}

// ── Selection types (what a buying agent submits) ────────────────────

export type SelectionValue = string | string[] | number | boolean;

export interface Selections {
  /** Keyed by OptionGroup.key. */
  options:   Record<string, SelectionValue>;
  quantity?: number;
}

// ── Result types ─────────────────────────────────────────────────────

export interface BreakdownLine {
  label:  string;
  amount: number; // USDC contribution of this line (may be negative)
}

export interface QuoteResult {
  ok:         boolean;
  errors:     string[];
  currency:   string;
  quantity:   number;
  unit_price: number;  // per-item price after option deltas and tier multiplier
  subtotal:   number;  // unit_price * quantity
  total:      number;  // subtotal after modifiers
  breakdown:  BreakdownLine[];
}

// ── Helpers ──────────────────────────────────────────────────────────

const round6 = (n: number): number => Math.round(n * 1_000_000) / 1_000_000;

function isOfferingSchema(s: unknown): s is OfferingSchema {
  return (
    !!s &&
    typeof s === 'object' &&
    Array.isArray((s as OfferingSchema).groups) &&
    typeof (s as OfferingSchema).base_price === 'number'
  );
}

/**
 * Validate a raw object as an OfferingSchema for surfacing to a buying agent
 * (get_offering_schema). Returns the typed schema or null when the product is
 * not actually configurable / has no usable schema.
 */
export function parseOfferingSchema(raw: unknown): OfferingSchema | null {
  return isOfferingSchema(raw) ? (raw as OfferingSchema) : null;
}

// ── Validation ───────────────────────────────────────────────────────

export function validateSelections(schema: OfferingSchema, sel: Selections): string[] {
  const errors: string[] = [];
  const groupByKey = new Map(schema.groups.map((g) => [g.key, g]));

  // Unknown group keys
  for (const key of Object.keys(sel.options ?? {})) {
    if (!groupByKey.has(key)) errors.push(`Unknown option "${key}".`);
  }

  for (const group of schema.groups) {
    const value = sel.options?.[group.key];
    const provided = value !== undefined && value !== null && value !== '';

    if (group.required && !provided) {
      errors.push(`Missing required option "${group.label}" (${group.key}).`);
      continue;
    }
    if (!provided) continue;

    const validChoiceKeys = new Set((group.choices ?? []).map((c) => c.key));

    switch (group.type) {
      case 'single_select': {
        if (typeof value !== 'string' || !validChoiceKeys.has(value)) {
          errors.push(`Option "${group.label}" must be one of: ${[...validChoiceKeys].join(', ')}.`);
        }
        break;
      }
      case 'multi_select': {
        if (!Array.isArray(value)) {
          errors.push(`Option "${group.label}" expects a list of choices.`);
          break;
        }
        for (const v of value) {
          if (typeof v !== 'string' || !validChoiceKeys.has(v)) {
            errors.push(`Option "${group.label}" has an invalid choice "${String(v)}".`);
          }
        }
        break;
      }
      case 'numeric': {
        if (typeof value !== 'number' || !isFinite(value)) {
          errors.push(`Option "${group.label}" expects a number.`);
          break;
        }
        if (group.min !== undefined && value < group.min) errors.push(`Option "${group.label}" must be at least ${group.min}.`);
        if (group.max !== undefined && value > group.max) errors.push(`Option "${group.label}" must be at most ${group.max}.`);
        break;
      }
      case 'boolean': {
        if (typeof value !== 'boolean') errors.push(`Option "${group.label}" expects true or false.`);
        break;
      }
      case 'text':
        // Free text never affects price and is not constrained here.
        break;
    }
  }

  // Quantity
  const qty = sel.quantity ?? 1;
  if (!Number.isFinite(qty) || qty < 1) {
    errors.push('Quantity must be a positive integer.');
  } else if (schema.quantity) {
    if (schema.quantity.min !== undefined && qty < schema.quantity.min) {
      errors.push(`Minimum quantity is ${schema.quantity.min}.`);
    }
    if (schema.quantity.max !== undefined && qty > schema.quantity.max) {
      errors.push(`Maximum quantity is ${schema.quantity.max}.`);
    }
  }

  return errors;
}

// ── Pricing ──────────────────────────────────────────────────────────

function tierMultiplier(spec: QuantitySpec | undefined, qty: number): { mult: number; tierMin: number | null } {
  if (!spec?.tiers || spec.tiers.length === 0) return { mult: 1, tierMin: null };
  let best = { mult: 1, tierMin: null as number | null };
  for (const t of spec.tiers) {
    if (qty >= t.min_qty && (best.tierMin === null || t.min_qty > best.tierMin)) {
      best = { mult: t.unit_multiplier, tierMin: t.min_qty };
    }
  }
  return best;
}

/**
 * Compute an advisory quote from a schema and a set of buyer selections.
 * Validates first; on any validation error returns ok:false with the errors
 * and a zeroed total so the caller never quotes a bad number.
 */
export function computeQuote(schema: OfferingSchema, sel: Selections): QuoteResult {
  const currency = schema.currency || 'USDC';
  const errors = validateSelections(schema, sel);
  if (errors.length > 0) {
    return { ok: false, errors, currency, quantity: 0, unit_price: 0, subtotal: 0, total: 0, breakdown: [] };
  }

  const qty = sel.quantity ?? 1;
  const breakdown: BreakdownLine[] = [];

  // Base
  let unit = schema.base_price;
  breakdown.push({ label: 'Base price', amount: round6(schema.base_price) });

  // Option contributions
  for (const group of schema.groups) {
    const value = sel.options?.[group.key];
    if (value === undefined || value === null || value === '') continue;
    const choiceByKey = new Map((group.choices ?? []).map((c) => [c.key, c]));

    if (group.type === 'single_select' && typeof value === 'string') {
      const c = choiceByKey.get(value);
      if (c?.price_delta) {
        unit += c.price_delta;
        breakdown.push({ label: `${group.label}: ${c.label}`, amount: round6(c.price_delta) });
      }
    } else if (group.type === 'multi_select' && Array.isArray(value)) {
      const included = group.included_count ?? 0;
      value.forEach((v, idx) => {
        const c = choiceByKey.get(String(v));
        if (!c) return;
        const free = idx < included;
        const delta = free ? 0 : (c.price_delta ?? 0);
        if (delta) {
          unit += delta;
          breakdown.push({ label: `${group.label}: ${c.label}`, amount: round6(delta) });
        }
      });
    } else if (group.type === 'numeric' && typeof value === 'number' && group.price_per_unit) {
      const delta = value * group.price_per_unit;
      unit += delta;
      breakdown.push({ label: `${group.label}: ${value}`, amount: round6(delta) });
    }
  }

  // Quantity tier multiplier on the per-item price
  const { mult, tierMin } = tierMultiplier(schema.quantity, qty);
  if (mult !== 1) {
    const before = unit;
    unit = unit * mult;
    breakdown.push({
      label:  `Volume tier (qty >= ${tierMin}): x${mult}`,
      amount: round6((unit - before)),
    });
  }
  unit = round6(unit);

  let subtotal = round6(unit * qty);
  if (qty !== 1) breakdown.push({ label: `Quantity x${qty}`, amount: round6(subtotal - unit) });

  // Modifiers (rush, etc.), toggled by boolean option groups
  let total = subtotal;
  for (const mod of schema.modifiers ?? []) {
    if (sel.options?.[mod.key] === true) {
      const add = mod.type === 'pct' ? subtotal * (mod.amount / 100) : mod.amount;
      total += add;
      breakdown.push({
        label:  mod.type === 'pct' ? `${mod.label} (+${mod.amount}%)` : `${mod.label} (+${mod.amount} ${currency})`,
        amount: round6(add),
      });
    }
  }
  total = round6(total);

  return { ok: true, errors: [], currency, quantity: qty, unit_price: unit, subtotal, total, breakdown };
}
