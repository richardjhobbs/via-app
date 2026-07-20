# OpenAI ACP / ChatGPT shopping — tracking + feed groundwork

Status as researched 2026-07-20. Goal: be ready to apply the day merchant
onboarding opens beyond approved partners.

## The July 2026 state of play

- **Instant Checkout is dead as a standalone experience.** OpenAI's own FAQ on
  chatgpt.com/merchants: "We're moving away from a standalone Instant Checkout
  experience in ChatGPT and prioritizing better shopping discovery and
  merchant-owned checkout experiences. Users can discover and evaluate products
  in ChatGPT, but purchases are completed on merchant-owned websites or apps."
  Launched Sept 2025 (Etsy, then ~30 Shopify brands), narrowed March 2026.
- **The merchant surface is now a product-feed discovery application**, not a
  checkout integration. That removes the expected Stripe blocker: no PSP is
  required to apply, and checkout happens on the merchant's own pages (for VIA:
  the product pages at app.getvia.xyz with existing card + USDC checkout).
- **Application route:** https://chatgpt.com/merchants (form at the bottom).
  Waitlist, approved partners only, rolling review. OpenAI says a self-serve
  merchant portal is coming "later this year". No fees on purchases.
- **Form fields:** name, work title, LinkedIn (required), work email, company,
  HQ country (worldwide), merchant website link, primary product categories
  (VIA fits Arts/Media + Fashion + Food & Beverage + Other), feed-readiness
  checkbox ("meets OpenAI's feed spec"), feed size by SKU count, notes.
- **Geography:** shopping surfaces to US ChatGPT users today; merchant HQ can
  be anywhere.
- **Marketplaces:** platforms onboard on behalf of sellers (Shopify + Etsy are
  integrated wholesale; Salesforce Agentforce Commerce GA'd its native feed
  sync July 2026). The feed spec has a `marketplace_seller` field: the
  marketplace is the point of checkout, `seller_name` is the fulfiller. There
  is no published policy on aggregators applying via the form, but the form's
  single-company shape plus the 100M+ SKU tier implies they are expected.
  **VIA applies once, as the platform, covering all integrated stores.**
  Per-store applications would be wrong: stores check out on VIA, and the form
  wants one company + one website + one feed.

## Feed spec (developers.openai.com/commerce/specs/feed)

- Delivery: SFTP push of full snapshots (Parquet+zstd preferred; jsonl.gz,
  csv.gz, tsv.gz accepted), at least daily, no deltas. Alternative: REST push
  API (bearer auth, Idempotency-Key, API-Version 2025-09-12). There is NO
  URL-pull mode, so our /api/acp/feed endpoint is the snapshot source an
  exporter will read, not the thing OpenAI ingests.
- Required fields: item_id (max 100), title (max 150), description (max 5000,
  plain text), url (must 200), brand (max 70), price ("79.99 USD", ISO 4217),
  availability (in_stock | out_of_stock | pre_order | backorder | unknown),
  image_url (JPEG/PNG), seller_name (max 70), seller_url, store_country +
  target_countries (ISO 3166-1 alpha-2), is_eligible_search,
  is_eligible_checkout.
- Optional/recommended: gtin (8-14 digits), mpn, condition (new | secondhand),
  product_category (" > " hierarchy), sale_price, variants (group_id,
  variant_dict, color/size), shipping (colon-delimited), return_policy URL,
  return_deadline_in_days, is_digital, star_rating, review_count.
- Caveat: OpenAI's docs are mid-migration between this flat schema and a
  nested one (seller.name, variant_options, description.html). Re-verify the
  live page before building the real exporter.
- Canonical protocol spec (checkout, delegated payment, feed API):
  github.com/agentic-commerce-protocol/agentic-commerce-protocol, current
  stable 2026-04-17. ChatGPT production still pins API-Version 2025-09-12.

## VIA mapping (implemented in app/api/acp/feed/route.ts)

Read-only, paginated (limit/offset, max 1000), Stage-1 integrated stores only
(`app_sellers.agent_wallet_address IS NOT NULL`, same gate as the per-seller
MCP), product rule mirroring buyableProducts(). ~71k items across 14 stores
today (4 vinyl stores dominate). Not submitted anywhere.

| ACP field | Source | Note |
|---|---|---|
| item_id | app_seller_products.id | uuid, under 100 chars |
| title | title | clipped 150 |
| description | via_enrichment.agentDescription, fallback description | HTML stripped, clipped 5000 |
| url | /sellers/{slug}/products/{id} | canonical product page |
| brand | metadata attrs brand/label/artist/maker, fallback seller name | vinyl uses label |
| gtin | metadata.vinyl.barcode when clean 8-14 digits | most vinyl barcodes are junk text |
| condition | conditionGrade present -> secondhand, else new | vinyl grades map to secondhand |
| product_category | enrichment.category "music/vinyl" -> "Music > Vinyl" | |
| price | price_minor / 1e6 as "N.NN USD" | USDC emitted as USD, 1:1; card buyers pay USD |
| availability | stock null/positive -> in_stock, else out_of_stock | |
| image_url | image_url or url column, only when it is a .jpg/.jpeg/.png URL | vinyl rows have NO stored image (url = source page) |
| is_digital | kind = digital | |
| seller_name / seller_url | app_sellers.name / seller page | |
| marketplace_seller | "VIA" | marketplace = point of checkout |
| store_country | app_sellers.shipping.ships_from_country | missing for most stores |
| is_eligible_search / is_eligible_checkout | true / false | discovery only |

## Gap list (what VIA cannot satisfy today)

1. **Images (the big one)**: image_url is REQUIRED by the spec, but the ~71k
   vinyl-ingest rows store no image link at all (the url column is the source
   page, image_url is null). Only onboarded stores with uploaded images (e.g.
   Eli's bakery) emit one. Before a real submission the vinyl ingest worker
   must also capture the Shopify image URL, or the feed ships vinyl-less.
2. **GTIN coverage**: vinyl barcodes are often free text ("N/A Includes --");
   clean leading 8-14 digit codes are extracted, the rest dropped. gtin is
   optional, but coverage hurts product matching quality.
3. **store_country / target_countries**: required by the spec, only present for
   sellers with a shipping config. Needs a backfill on app_sellers.shipping or
   a per-seller default before a real submission.
4. **No variants**: app_seller_products has no variant rows (pricing_mode +
   option_schema instead). Configurable products emit the base price only.
5. **Refresh cadence**: feed must be pushed at least daily as a full snapshot.
   Needs a small exporter (paginate /api/acp/feed -> jsonl.gz -> SFTP) plus a
   daily cron. Do not build until VIA is accepted off the waitlist.
6. **return_policy URL**: spec wants one; VIA has no per-store returns page.
   A platform-level returns/terms page would satisfy it.
7. **Checkout rails**: moot for the current discovery-only surface. If OpenAI
   revives embedded checkout, ACP delegated payment is card-only (Stripe
   SharedPaymentToken, Adyen, Braintree): VIA would need a PSP integration in
   front of x402 settlement. Park until OpenAI signals checkout is back.

## Paid-door check

Feed emits title, description, price, image: the same data already public on
/api/via/search and the storefront pages. No brief, pitch, offer, or
negotiation content. Invariant holds.
