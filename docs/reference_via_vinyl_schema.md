# VIA Vinyl Listing Schema v0.1

Reference for the vinyl-records seller category. This is the locked schema. The
onboarding scripts that populate it are built separately, in the same flow as the RRG
Stage 1 (scrape) / Stage 2 (onboard) process but with no image or vision enhancement.

## Principle

Reuse the existing VIA listing object. A vinyl record is an ordinary
`app_seller_products` row with one extra convention: a `vinyl` object inside the existing
`metadata` jsonb column. No migration, no new table, no dedicated columns for v1.

VIA is already data-only (`feedback_via_is_data_not_images.md`), so the "drop the image
pipeline" requirement is satisfied by construction: there is nothing image-related to drop.

## The listing row

A vinyl listing is `app_seller_products` with:

- `kind = 'physical'`
- `pricing_mode = 'fixed'` (one pressing is one SKU at one price; do not use `configurable`)
- core fields unchanged: `title`, `description`, `price_minor`, `currency`, `stock`,
  `seller_id`, `url`, `external_id`
- `metadata.vinyl` holding the record-specific attributes below

## metadata.vinyl

```
metadata.vinyl = {
  artist             string
  title              string
  format             string    // "LP", "12\"", "7\"", "2xLP", etc.
  label              string
  catalogue_number   string
  pressing_country   string
  pressing_year      int
  media_grade        enum      // Goldmine: M, NM, VG+, VG, G+, G, F, P
  sleeve_grade       enum      // same scale
  condition_notes    text      optional
  play_tested        bool      optional
  matrix_runout      string    optional, seller-entered
  discogs_release_id int       optional, seller-entered for now (resolver is phase 2)
}
```

Grades use the Goldmine scale: Mint (M), Near Mint (NM), Very Good Plus (VG+), Very Good
(VG), Good Plus (G+), Good (G), Fair (F), Poor (P).

## Validation gate (v1)

Enforced where the existing publish gate lives, `lib/app/publish-product.ts`, on the
draft -> registered transition:

1. `price_minor > 0` (existing rule, unchanged)
2. `metadata.vinyl.media_grade` is present and in the enum
3. `metadata.vinyl.sleeve_grade` is optional; if present it must be in the enum, if
   absent it is surfaced to buyers as "not specified"
4. `discogs_release_id` is NOT gated in v1 (soft, seller-entered)

The media grade (the record grade, which governs playability) plus price are the v1
integrity guarantee. Sleeve grade is optional because most 12"/DJ dealers (e.g.
recycle-vinyl) grade the record only and ship generic sleeves; requiring a sleeve grade
they never gave would either block the whole catalogue or invite invented grades. For a
detail-obsessed buyer an agent reading a specific pressing's catalogue number, year,
country and record grade has more verifiable information than a photo gives a human.

## Ingestion (v1)

Shopify first, following VIA's existing integration process; CSV second.

- **Shopify (primary).** Reuse the existing Shopify import in `lib/app/catalog-import.ts`.
  Add a vinyl mapping step that parses the dealer's product title, tags and body into the
  `metadata.vinyl` block. Catalogue number, format and grades are commonly embedded in a
  vinyl dealer's Shopify product title or tags. This mirrors RRG's
  `onboard-brand.mjs` -> `brand-mirror.mjs` pattern but writes `app_seller_products` rows
  with no image handling.

- **CSV (secondary).** Extend the existing 8-column sync-csv schema
  (`lib/app/csv-import.ts`, endpoint `app/api/seller/[sellerId]/products/sync-csv`) with
  optional vinyl columns: `catalogue_number` (or `barcode`), `media_grade`, `sleeve_grade`,
  `condition_notes`, `format`. Validate the grades against the enum in `validateRows`, and
  stash the vinyl fields into `metadata.vinyl` during `importCatalog`. The existing parse,
  FX, dedupe and upsert paths are reused unchanged.

- **Discogs.** Any Discogs scraping or CC0 resolver is phase 2 (see below).

## Agent exposure

The per-seller MCP `get_product` already returns the full `metadata` object
(`app/sellers/[slug]/mcp/route.ts`), so `metadata.vinyl` is visible to agent buyers with
no MCP change. Confirm this in verification.

## Deferred to phase 2

- Discogs CC0 dump ingestion and a match index (artist + title + catalogue number + barcode).
  Marketplace pricing, inventory and images from Discogs are restricted, not CC0, and must
  never be scraped. Only the CC0 release database is used.
- A hard publish gate requiring a resolved `discogs_release_id`.
- A recognizer for the seller's native Discogs inventory-export CSV layout.
- Price comps built from VIA's own sales history.

## Handoff to Code

Representative touch points, not an exhaustive list:

- vinyl mapping in the Shopify import path, `lib/app/catalog-import.ts`
- optional vinyl columns in `lib/app/csv-import.ts`
- the grades-present publish check in `lib/app/publish-product.ts`
- confirm `get_product` surfaces `metadata.vinyl`, `app/sellers/[slug]/mcp/route.ts`

No DB migration is required for v1. Keep the vinyl block as a metadata convention; do not
add dedicated columns unless a later phase needs indexed search over a vinyl field.
