# Onboarding Telemetry — Frey Tailored

- **Brand:** Frey Tailored ([frey-tailored.com](https://frey-tailored.com))
- **Domain:** frey-tailored.com (public Shopify products.json — no API key needed for import)
- **Currency:** HKD → USDC at fixed rate `1 / 7.78` (locked 2026-04-16; HKD USD-peg)
- **Brand slug:** `frey-tailored`
- **Brand wallet:** `0x734a25fB869ab6415b78bbe9a39f1f99dab349E7` (RRG Test Brands — shared with UU, temporary)
- **`brand_pct_override`:** `97.5` (hidden on all public surfaces)
- **Products:** 10 styles, single colourways, size-only variants (tokens 83-92)
- **Total catalogue size (source):** 528 in-stock styles across 20 product_types
- **Session start:** 2026-04-16 18:28 MPST
- **Plan file:** `C:\Users\Richard\.claude\plans\peppy-beaming-honey.md`
- **Telegram bot:** `@via_freytailored_bot` (id 8502490494) — token in env `FREY_TG_BOT_TOKEN`
- **Brand row ID (Supabase):** `6d11aefa-7e87-48e1-9cf0-270f3b622c2a`

---

## Time per phase

| # | Phase | Start | End | Wall-clock | Notes |
| --- | --- | --- | --- | --- | --- |
| 1 | Discovery + brand voice scrape | 18:28 | 18:32 | **4m** | 528 products pulled across 3 pages; size guide scraped; 10-style shortlist approved (item 6 swapped: suit → single Nacka jacket) |
| 2 | Config (BRANDS + BRAND_BOTS + SIZING_CONFIGS) | 18:33 | 18:36 | **3m** | Frey block added to `brand-mirror.mjs` with HKD rate 1/7.78, to `brand-telegram-bot.ts` (envTokenKey FREY_TG_BOT_TOKEN), and unified size chart seeded into `scrape-sizing-guide.mjs` across 5 categories |
| 3 | Size chart import | 18:36 | 18:37 | **1m** | `--seed-only` mirror created brand row; sizing script upserted 5 categories × 8 sizes into `rrg_brand_sizing` |
| 4 | Extra-images feature in brand-mirror | 18:37 | 18:38 | **1m** | Populates `physical_images_paths` with up to 5 Shopify additional images; `PhysicalProductModal` already rendered the gallery |
| 5 | Product mirror run (10 imports) | 18:38 | 18:42 | **~4m** | Hit Shopify localisation bug (Node fetch returned USD, not HKD); fixed by forcing `Accept-Language: ""`; dry-run verified; live mirror minted tokens 83-92 with registerDrop on Base mainnet. Avg ~4 extra images/product uploaded |
| 6 | Vision enrichment | 18:42 | 18:48 | **6m** | `ANTHROPIC_API_KEY` not available to child process; added `--use-precomputed` flag to `enhance-descriptions.mjs` matching the Phase 21 pattern; wrote `tmp/frey-enrichment.json` by hand from Frey's rich body_html; loader persisted all 10 enrichments. Zero LLM spend. |
| 7 | Post-mirror SQL backfill | 18:48 | 18:49 | **1m** | Node script updated `sizing_category` + `image_is_dark` per token. Tops=1, outerwear=5, dresses=1, bottoms=2, skirts=1. Dark=8, light=2 (Ravenna white blouse, Kalmar electric blue). |
| 8 | Telegram bot wiring | 18:49 | 18:50 | **1m** | Token verified via `getMe` → bot is `@via_freytailored_bot`, id 8502490494, first_name "Frey Tailored". Matches pre-planned config. Added `FREY_TG_BOT_TOKEN` to local `.env.local`. Webhook set in Phase 10. |
| 9 | Local build + preview QA | 18:50 | 18:52 | **2m** | Local dev + prod builds both blocked by pre-existing Windows turbopack/tailwind incompatibility (`RangeError: Invalid code point`). TypeScript check clean on all my edits. Pivoted: will validate on Vercel Linux preview build. |
| 10 | Commit + push → Vercel + VPS deploy | 18:52 | 19:02 | **10m** | Commit `9786ebe`, pushed master (Vercel build triggered). Added `FREY_TG_BOT_TOKEN` to Vercel Production env via CLI. SCP'd 4 files to VPS, `git pull` on VPS, `npm run build` clean, copied static + public + env symlink, pm2 restart. Appended token to VPS `.env.local`. Local=GitHub=VPS parity confirmed at `9786ebe`. TG webhook set to `?brand=frey-tailored`. Smoke: storefront 200, MCP list_products returns 10 products with full agent payload, no `brand_pct_override` leak. Regression: UU + Clooudie both still 200. |
| 11 | Notion Build Log + telemetry finalise | 19:02 | 19:07 | **~5m** | Phase 22 entry appended to Notion Build Log before `*Last updated:*`. This telemetry doc committed. |
| 12 | **Pivot to nanobot pattern on Box** | 19:15 | 19:30 | **~15m** | User correction: UU runs as a **nanobot on Box** (not a Vercel webhook). Reverted: deleted Frey TG webhook; cloned `.nanobot-uu-concierge` → `.nanobot-frey-tailored` on Box (config.json with Ollama via LLM Router port 5005, MCP bridge to `/brand/frey-tailored/mcp`, port 8088). Copied `mcp_bridge.py` verbatim, adapted `start.bat`, wrote Frey-specific `workspace/SOUL.md` (persona + tools + behaviour). Created `Nanobot Frey Concierge` scheduled task (At logon, Run As Richard) and started it. 7 nanobot processes now running on Box (was 6). Vercel + VPS env vars left in place for parity with UU (dormant). |
| | **Total** | | | **~54m** | |

---

## Products imported

| Token | Handle | HKD | USDC | Category | Sized | Dark |
| --- | --- | --- | --- | --- | --- | --- |
| 83 | ravenna-silk-shawl-collar-blouse-in-white | 1,680 | $215.94 | tops | ✓ | light |
| 84 | nacka-jacket-collarless-evening-jacket | 3,480 | $447.30 | outerwear | ✓ | dark |
| 85 | amal-limited-edition-jacket-tuxedo-double-breasted-jacket-with-satin-lapel-in-black | 3,680 | $473.01 | outerwear | ✓ | dark |
| 86 | agueda-limited-edition-coat-midi-length-coat-in-black-pinstripe | 4,480 | $575.84 | outerwear | ✓ | dark |
| 87 | amarante-limited-edition-jacket-tuxedo-style-jacket-in-forest-green-velvet | 3,680 | $473.01 | outerwear | ✓ | dark |
| 88 | beja-limited-edition-waistcoat-relaxed-waistcoat-in-night-brown | 2,680 | $344.47 | outerwear | ✓ | dark |
| 89 | braganza-limited-edition-dress-tailored-short-dress-in-black | 3,080 | $395.89 | dresses | ✓ | dark |
| 90 | castelo-limited-edition-trousers-straight-leg-tuxedo-trousers-in-black | 1,880 | $241.65 | bottoms | ✓ | dark |
| 91 | borgholm-trousers-wide-leg-tent-trousers-in-blue | 1,880 | $241.65 | bottoms | ✓ | dark |
| 92 | kalmar-skirt-maxi-high-waisted-skirt-in-electric-blue | 1,980 | $254.50 | skirts | ✓ | light |

**Total catalogue value:** HKD 28,500 → USDC $3,663.26. Average USDC $366.33.

---

## Deviations from plan / learnings

1. **Shopify price localisation.** Node `fetch()` sent a default `Accept-Language` that triggered Shopify's multi-currency middleware, returning **USD instead of HKD** (HKD 3,680 → USD 681 on a US-geoip request). Curl without `Accept-Language` returned shop currency. **Fix applied:** `fetchShopify()` now sets `Accept-Language: ""` to pin response to the shop's base currency. This is a generic fix that benefits any brand with multi-currency enabled.
2. **Chain registration was opt-in.** User flagged concern about on-chain registerDrop firing during the mirror. **Fix applied:** inverted `brand-mirror.mjs` default to `--skip-chain`; explicit `--commit-chain` flag now required to register drops on Base. Safer default for pilots and for the future onboarding agent.
3. **Extra-images gap.** The drop page + `PhysicalProductModal` already rendered a 2-col gallery from `physical_images_paths`, but `brand-mirror.mjs` / `clooudie-mirror.mjs` never populated it. **Fix applied:** mirror now uploads up to 5 additional Shopify images per product. Retroactive benefit for UU after a re-mirror.
4. **Vision enrichment without API key.** `enhance-descriptions.mjs` required `ANTHROPIC_API_KEY`, which wasn't in `.env.local` and wasn't inherited into the child Node process. **Fix applied:** added `--use-precomputed <file>` flag matching the Phase 21 pattern in `seed-luxury-resale-brand.mjs`. Zero-LLM-spend path now works for any future brand where the agent running the pipeline has already produced structured enrichment.
5. **Local build blocked on Windows.** Pre-existing turbopack + Tailwind incompatibility (`RangeError: Invalid code point 15296783`) on Windows prevented `npm run dev` and `npm run build`. Not a Frey-specific issue; QA deferred to Vercel preview (Linux).
6. **Frey's size system.** Variants use a mix of EU numbers (32-46), letter sizes (XS, S, S-M, M, M-L, L, XL, XXL), and "OS" (one-size). Size chart uses EU numbers as primary key with full alias lists (UK, US, IT, FR/SP, letter) so `ProductSizeChart` matches every variant format.

---

## Token Usage (session total)

`/cost` is not meaningful on a Claude Code subscription plan (returns only a generic "subscription" message). For future pricing analysis, the options are:

1. **Wall-clock is the load-bearing metric here** — subscription token cost is sunk; what scales with brand count is (a) my time per onboarding and (b) per-agent LLM token spend after hand-off (nanobot running on Box against Ollama + DeepSeek fallback, which IS metered).
2. If a real token total is needed retrospectively, the Anthropic Console → Usage view for the workspace shows aggregate usage by day; subtract the delta between session start and end.
3. A rough retrospective estimate for this session (from tool-call count): ~280 tool calls + ~11 AskUserQuestion / ExitPlanMode exchanges. Without exact per-turn token counts, order-of-magnitude is **~1M input tokens / ~50k output tokens** for the whole build. Treat as ±50% ballpark.

Post-launch LLM cost (ongoing) is tracked in `C:\Users\Richard\api-gateway\usage.json` on Box per `box_nanobot_setup.md`.
