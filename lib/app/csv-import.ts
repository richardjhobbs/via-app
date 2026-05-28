/**
 * lib/app/csv-import.ts
 *
 * Spreadsheet (CSV / XLSX) → app_seller_products import pipeline.
 *
 * Pattern ported from via-brand-onboarding's lib/ingest (parseFile +
 * validateRows) but stripped to the data-only VIA shape per
 * feedback_via_is_data_not_images.md.
 *
 * Schema (8 columns, see reference_via_csv_schema.md):
 *   title           required, 2–200 chars
 *   price           required, number in seller.source_currency, > 0
 *   description     optional, ≤4000 chars
 *   stock           optional integer, blank = unlimited
 *   max_supply      optional integer
 *   url             optional URL
 *   external_id     optional stable upsert key
 *   kind            optional enum (physical|digital|service), default physical
 *
 * Pipeline:
 *   buffer → parseFile → RawRow[] → validateRows → CsvValidationResult
 *           → toShopifyShape → ShopifyProduct[] → importCatalog
 */

import Papa from 'papaparse';
import * as XLSX from 'xlsx';
import type { ShopifyProduct, ShopifyVariant } from '../shopify/products-json';

// ── Raw row shape ─────────────────────────────────────────────────────

export interface RawRow {
  rowIndex: number;                 // 1-based, header excluded
  values:   Record<string, string>; // header → cell, trimmed
}

// ── Normalised row (post-validate) ───────────────────────────────────

export type ProductKind = 'physical' | 'digital' | 'service';

export interface NormalisedCsvProduct {
  sourceRef:    string;             // row index for error reporting
  externalId:   string | null;
  title:        string;
  description:  string | null;
  priceNative:  number;             // in seller.source_currency
  stock:        number | null;      // null = unlimited
  maxSupply:    number | null;
  url:          string | null;
  kind:         ProductKind;
}

export interface RowError {
  row:     string;
  field?:  string;
  message: string;
}

export interface CsvValidationResult {
  ok:        boolean;
  products:  NormalisedCsvProduct[];
  errors:    RowError[];
}

// ── Parse ─────────────────────────────────────────────────────────────

function trimRowValues(values: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(values)) {
    out[String(k).trim().toLowerCase()] = String(v ?? '').trim();
  }
  return out;
}

export function parseCsv(buffer: Buffer): RawRow[] {
  const text = buffer.toString('utf8').replace(/^﻿/, ''); // strip BOM
  const parsed = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.trim(),
  });
  const rows: RawRow[] = [];
  parsed.data.forEach((values, i) => {
    const trimmed = trimRowValues(values ?? {});
    if (Object.values(trimmed).every((v) => !v)) return;
    rows.push({ rowIndex: i + 1, values: trimmed });
  });
  return rows;
}

export function parseXlsx(buffer: Buffer): RawRow[] {
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  const sheetName =
    workbook.SheetNames.find((n) => n.toLowerCase() === 'products') ??
    workbook.SheetNames[0];
  if (!sheetName) return [];
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) return [];
  const json = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
    raw: false,
    defval: '',
  });
  const rows: RawRow[] = [];
  json.forEach((values, i) => {
    const trimmed = trimRowValues(values);
    if (Object.values(trimmed).every((v) => !v)) return;
    rows.push({ rowIndex: i + 1, values: trimmed });
  });
  return rows;
}

export function parseFile(filename: string, buffer: Buffer): RawRow[] {
  const lower = filename.toLowerCase();
  if (lower.endsWith('.csv'))                                    return parseCsv(buffer);
  if (lower.endsWith('.xlsx') || lower.endsWith('.xls'))         return parseXlsx(buffer);
  throw new Error(`Unsupported file type: ${filename}. Use .csv, .xlsx, or .xls.`);
}

// ── Validate ──────────────────────────────────────────────────────────

const MAX_ROWS = 5_000; // hard cap to avoid runaway uploads

function parseNumber(raw: string): number {
  return Number(raw.replace(/[^0-9.\-]/g, ''));
}

function parseIntOrNull(raw: string): number | null | 'invalid' {
  if (!raw) return null;
  const n = Number(raw.replace(/[^0-9\-]/g, ''));
  if (!Number.isInteger(n)) return 'invalid';
  return n;
}

export function validateRows(rows: RawRow[]): CsvValidationResult {
  const errors:   RowError[]              = [];
  const products: NormalisedCsvProduct[]  = [];

  if (rows.length === 0) {
    errors.push({ row: 'all', message: 'The spreadsheet is empty. Add at least one product row.' });
    return { ok: false, products: [], errors };
  }
  if (rows.length > MAX_ROWS) {
    errors.push({ row: 'all', message: `Too many rows (${rows.length}). Maximum per upload is ${MAX_ROWS}.` });
    return { ok: false, products: [], errors };
  }

  const seenExternalIds = new Set<string>();

  rows.forEach((r) => {
    const v      = r.values;
    const rowRef = String(r.rowIndex);

    // Required: title
    const title = (v.title ?? '').trim();
    if (!title || title.length < 2 || title.length > 200) {
      errors.push({ row: rowRef, field: 'title', message: `Row ${rowRef}: title is required and must be 2–200 characters.` });
    }

    // Required: price
    const priceRaw = v.price ?? '';
    const price = parseNumber(priceRaw);
    if (!Number.isFinite(price) || price <= 0) {
      errors.push({ row: rowRef, field: 'price', message: `Row ${rowRef}: price must be a positive number (in the seller's source currency).` });
    }

    // Optional: description (cap length)
    const description = (v.description ?? '').slice(0, 4000) || null;

    // Optional: stock — integer or blank
    const stockParsed = parseIntOrNull(v.stock ?? '');
    if (stockParsed === 'invalid') {
      errors.push({ row: rowRef, field: 'stock', message: `Row ${rowRef}: stock must be a whole number, or blank for unlimited.` });
    }
    const stock = stockParsed === 'invalid' ? null : stockParsed;
    if (typeof stock === 'number' && stock < 0) {
      errors.push({ row: rowRef, field: 'stock', message: `Row ${rowRef}: stock cannot be negative.` });
    }

    // Optional: max_supply — integer or blank
    const maxSupplyParsed = parseIntOrNull(v.max_supply ?? '');
    if (maxSupplyParsed === 'invalid') {
      errors.push({ row: rowRef, field: 'max_supply', message: `Row ${rowRef}: max_supply must be a whole number, or blank for unlimited (1e9 sentinel).` });
    }
    const maxSupply = maxSupplyParsed === 'invalid' ? null : maxSupplyParsed;
    if (typeof maxSupply === 'number' && maxSupply <= 0) {
      errors.push({ row: rowRef, field: 'max_supply', message: `Row ${rowRef}: max_supply must be a positive integer.` });
    }

    // Optional: url
    const urlRaw = (v.url ?? '').trim() || null;
    if (urlRaw) {
      try { new URL(urlRaw); }
      catch {
        errors.push({ row: rowRef, field: 'url', message: `Row ${rowRef}: url must be a full URL starting with http:// or https://.` });
      }
    }

    // Optional: external_id (dedupe within upload)
    const externalId = (v.external_id ?? '').trim() || null;
    if (externalId) {
      if (seenExternalIds.has(externalId)) {
        errors.push({ row: rowRef, field: 'external_id', message: `Row ${rowRef}: external_id "${externalId}" appears more than once in this upload.` });
      }
      seenExternalIds.add(externalId);
    }

    // Optional: kind enum
    const kindRaw = (v.kind ?? '').toLowerCase().trim();
    let kind: ProductKind = 'physical';
    if (kindRaw) {
      if (kindRaw !== 'physical' && kindRaw !== 'digital' && kindRaw !== 'service') {
        errors.push({ row: rowRef, field: 'kind', message: `Row ${rowRef}: kind must be physical, digital, or service.` });
      } else {
        kind = kindRaw as ProductKind;
      }
    }

    products.push({
      sourceRef:    rowRef,
      externalId,
      title,
      description,
      priceNative:  Number.isFinite(price) ? price : 0,
      stock:        typeof stock === 'number' ? stock : null,
      maxSupply:    typeof maxSupply === 'number' ? maxSupply : null,
      url:          urlRaw,
      kind,
    });
  });

  return { ok: errors.length === 0, products, errors };
}

// ── Adapter: NormalisedCsvProduct[] → ShopifyProduct[] ───────────────
//
// Lets us reuse lib/app/catalog-import.ts importCatalog without
// reinventing the upsert + FX path. Each CSV row becomes a
// single-variant ShopifyProduct; the variant's price is the native
// price as a string, and `available: true` so the catalog mapper's
// "any variant available" check passes (stock is carried out-of-band
// via a totalStockFor closure).

export function toShopifyShape(products: NormalisedCsvProduct[]): ShopifyProduct[] {
  return products.map((p, idx) => {
    const variant: ShopifyVariant = {
      id:               0,
      title:            'Default',
      price:            p.priceNative.toFixed(2),
      compare_at_price: null,
      sku:              null,
      available:        true,
      position:         1,
    };
    return {
      id:           0,
      title:        p.title,
      handle:       p.externalId ?? `csv-row-${p.sourceRef}-${idx + 1}`,
      body_html:    p.description,
      vendor:       null,
      product_type: p.kind,
      tags:         [],
      variants:     [variant],
      images:       [],
    };
  });
}

// Per-row stock lookup used by importCatalog's totalStockFor closure.
// Builds a lookup keyed on the synthesised handle so the mapper can
// recover the CSV's stock + max_supply without restructuring.
export function buildCsvStockMap(products: NormalisedCsvProduct[]): Map<string, { stock: number | null; maxSupply: number | null; kind: ProductKind }> {
  const m = new Map<string, { stock: number | null; maxSupply: number | null; kind: ProductKind }>();
  products.forEach((p, idx) => {
    const handle = p.externalId ?? `csv-row-${p.sourceRef}-${idx + 1}`;
    m.set(handle, { stock: p.stock, maxSupply: p.maxSupply, kind: p.kind });
  });
  return m;
}
