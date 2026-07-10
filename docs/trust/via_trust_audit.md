# VIA Trust & Security Audit

Date: 2026-07-09. Scope: VIA App (`app.getvia.xyz`) primary, with sibling repos (CRM, MCP server, website, demo). Method: code read, first-hand plus verified sub-agent reports. Where a claim could not be backed by code it is marked `[GAP: ...]`. No secret values are printed anywhere; only names and locations.

Corporate entity: VIA Labs Pte. Ltd., Singapore (from `lib/app/terms.ts`). Founder contact: richard@entrepot.asia. Supabase project: `via-agent-mcp`, id `gcxyoujubqclenrhhill` (from project memory / CLAUDE.md; not re-derivable from source alone).

One framing correction up front: VIA does **not** reach into a seller's own systems on connect. There is no OAuth into seller infrastructure and no "read scope" over a seller's backend. VIA runs the reverse: it hosts an MCP that buyer agents call, and a seller either registers a store (name, wallet, email) and publishes products, or has a public catalogue ingested. The only seller-system credential VIA can hold is an optional encrypted Shopify Storefront token (read-only, published products) for ingested/RRG-style brands.

---

## STEP 1 — Findings

### 1a. MCP permissions & scopes

VIA exposes four MCP surfaces. All product-facing ones are public by design.

**Central discovery MCP** `app.getvia.xyz/mcp` (`app/mcp/route.ts`). Auth: none. The static server card (`app/.well-known/mcp/server-card.json/route.ts:14`) declares `authentication: { schemes: ['none'] }`. Tools (8):
- `list_sellers`, `find_seller`, `get_seller_products`, `seller_mcp_url`, `get_via_overview` — read-only discovery.
- `register_store` — the one write. Creates a Supabase auth user + a pending `app_sellers` row. Rate-limited 5 per IP per 5 min, per warm instance (`app/mcp/route.ts:48-63`). Every store is human-reviewed before going live.
- `get_store_status` — read.
- `import_preference_appraisal` — write, but scoped by a `link_token` the buyer owner minted in their own dashboard (`app/mcp/route.ts:487-540`). VIA never receives raw email.

**Per-seller MCP** `/sellers/[slug]/mcp` (`app/sellers/[slug]/mcp/route.ts`). Auth: none (public buyer-facing). Tools (~13): `list_products`, `get_product`, `get_seller_info`, `ask_sales_agent`, `get_shipping_quote`, `buy_product`, `claim_pass`, `get_offering_schema`, `request_quote`, `get_quote`, `get_download_challenge`, `get_download_links`, `get_owner_management_info`. `buy_product` returns an x402 payment requirement; it does not move funds itself. Digital downloads are double-gated: a wallet-signature challenge proves control of the paying wallet, and a settled `app_purchases` row must exist (`route.ts:383-436`, `lib/app/store-auth.ts`). Rate-limited 30 per (ip|agent) per 60s, per warm instance.

**Per-seller management MCP** `/sellers/[slug]/manage/mcp`. Auth: wallet-signature challenge (see 1d). Tools (5): `get_challenge`, `authenticate`, `create_product`, `list_my_products`, `publish_product` (mints on Base, irreversible). This is the only write path into a seller's own catalogue, and it requires signing with a wallet the seller controls.

**Per-buyer MCP** `/buyers/[handle]/mcp` (`app/buyers/[handle]/mcp/route.ts`). Tools (5): `get_buyer_preferences` (public-safe slice, PII/caps stripped), `get_buyer_briefs` (free teasers only), `submit_intent` (credit-gated), `negotiate` (gated on a paid offer, returns 402 otherwise, `route.ts:319`), `accept_offer` (evaluates against delegation caps deterministically; caps are never sent to the LLM, `route.ts:184-191, 244`).

Least-privilege: mostly yes. Discovery/buy tools are read-or-quote. The only writes are register_store (human-gated), publish_product (wallet-gated), and buyer-scoped writes (token/credit-gated). No delete/send scopes are exposed to callers. Server manifest: the server card at `.well-known/mcp/server-card.json` plus `.well-known/agent-card.json`; both declare `schemes: ['none']` for the public tools.

### 1b. Data flows

**Collected at seller registration** (`lib/app/store-registration.ts:86-223`): store name, kind, description, headline, website URL, payout wallet (a public EOA), contact email, password. Password is handed to Supabase Auth and stored hashed by Supabase; VIA does not store it in plaintext. The platform-derived agent identity wallet is created server-side; its private key is never stored (re-derived from `AGENT_WALLET_SEED`).

**MCP call logging** (`logInteraction`, `app/sellers/[slug]/mcp/route.ts:122-143`): every tool call is written fire-and-forget to `app_mcp_interactions` with `seller_id`/`buyer_id`, `tool_name`, `agent_identity` ({via_agent_id, user_agent, ip}), `request` (jsonb), `response` (jsonb), `status_code`, `duration_ms`. `ask_sales_agent` truncates the logged question to 200 chars; several other tools log the full request/response object. Buyer delivery addresses are stored in `app_purchases.delivery_address`, not in the interaction log (buy_product logs only `has_delivery: bool`, wallet, country).

**To third parties:**
- DeepSeek (LLM): buyer briefs, buyer questions, product data, and locked-in seller memories are sent to `api.deepseek.com` (`lib/app/sales-agent.ts`, `buyer-llm.ts`, `buyer-matching.ts`, `buying-agent.ts`).
- Coinbase CDP facilitator (`api.cdp.coinbase.com`, `lib/app/x402-gate.ts`): signed USDC transfer authorizations, wallet addresses, amounts. VIA never custodies buyer funds; the facilitator settles and sponsors gas.
- Resend (`api.resend.com`, `lib/app/email.ts`, from `deliver@getvia.xyz`): transactional email including recipient email, order details, and for physical orders the shipping address, plus tx hash and any voucher codes.
- Thirdweb: human wallet creation from email/social, client-side (`lib/app/thirdwebClient.ts`).
- NOSTR public relays (`lib/app/broadcast/nostr.ts`): demand is broadcast as a redacted teaser only (category + product type + one attribute + door URL); the full brief stays behind the x402 door. Offer receipts are posted after settlement.

**Buyer data to sellers:** governed by the paid-door invariant and confirmed first-hand. Free tier = redacted teasers (no raw wording, no budget, no PII). Full structured brief, offer submission, and negotiation are all behind the x402 door (`app/buyers/[handle]/mcp/route.ts:287-343`). Delegation caps are enforced deterministically and never exposed to a seller or to the LLM.

**Not active:** `lib/app/mem0.ts` exists but is imported nowhere (grep: 1 file, itself). It is dormant RRG-inherited code, not a live data flow. No Sentry/PostHog/analytics found.

### 1c. Storage

- Host: Supabase (managed Postgres), project `via-agent-mcp` id `gcxyoujubqclenrhhill`. Server access uses `SUPABASE_SERVICE_ROLE_KEY` (`lib/app/db.ts:12-25`), which bypasses RLS. `persistSession: false`.
- Encryption at rest: Supabase encrypts data at rest with AES-256 as a platform default (managed by Supabase/AWS; not asserted in our code, so treat as platform behavior). Field-level: buyer bring-your-own LLM keys are AES-256-GCM with a 32-byte key from `BYO_KEY_ENCRYPTION_KEY` (`lib/app/byo-key-crypt.ts`). Shopify Storefront tokens are stored in `shopify_storefront_token_encrypted` but the encrypt/decrypt routine is inherited RRG code, not present in via-app. `[GAP: Shopify token encryption algorithm/key location not verified in via-app source.]`
- Region: `[GAP: Supabase project region not verifiable from code; needs the dashboard. Relevant for a Southeast Asia market.]`
- Retention: none in code. `app_mcp_interactions` has no TTL, no deletion trigger, grows indefinitely. A `cleanup-intents` cron exists for stale intents only, not user data. `[GAP: no retention policy.]`
- Backups: `[GAP: Supabase-managed backups assumed, not configured in code.]`

### 1d. Auth & access control

- Human sellers/buyers: Supabase email/password, cookies `sb-access-token`/`sb-refresh-token`, 1h access token, middleware silently refreshes near expiry (`middleware.ts:54-64`). Seller roles via `app_seller_members` (owner/admin/viewer).
- Seller agents (catalogue management): wallet-signature challenge, stateless HMAC over `slug|wallet|exp`, secret is `STORE_AUTH_SECRET` or fallback `ADMIN_SECRET` (`lib/app/store-auth.ts:21-22`). Challenge TTL 5 min. Session token `via_sk_...` stored as SHA-256 hash in `app_sellers.agent_api_key_hash`, rotates on each `authenticate`, constant-time compared (`lib/app/store-keys.ts`).
- Buyer wallet auto-connect: short-lived RS256 JWT, 5 min, key `VIA_WALLET_JWT_PRIVATE_KEY` (`lib/app/wallet-jwt.ts`).
- Superadmin: a single shared bearer token `ADMIN_SECRET` (header or 7-day cookie). No per-operator identity, no audit trail beyond HTTP logs. Read-only `ADMIN_READONLY_SECRET`. Per-brand concierge access is HMAC(slug) bound so one brand cannot read another (`lib/app/auth.ts:79-104`).
- Seller revocation of VIA access: no self-service path found. Only a superadmin `POST /api/admin/sellers/[id]/deactivate` sets `active=false`, which hides the store and blocks the management MCP. No "revoke all sessions" and no buyer/seller data-deletion endpoint. `[GAP: no PDPA/GDPR data-subject deletion path.]`
- RLS: enabled on `app_*` tables, owner-scoped by `auth.uid()`. But the app server holds the service-role key, so RLS protects against direct anon-key/client access, not against the server or an `ADMIN_SECRET` holder. A prior migration (0008) had `app_seller_customer_notes` RLS-disabled before it was fixed.
- Agent runtime reachability: the standalone seller-agent runs on the Hetzner VPS `89.167.89.219` as an outbound cron process (polls VIA + RRG, pays the x402 door), deployed by scp, no inbound public listener. The Tailscale box `100.80.225.34` is not referenced anywhere in code. `[GAP: Tailscale box role and public reachability not determinable from source; Tailscale is a private mesh by design.]`

### 1e. CRM (`crm.getvia.xyz`)

`[GAP: this repo's audit did not complete this run. Known from the global repo table: Vercel-hosted. Not verified this run: whether it shares the `via-agent-mcp` Supabase project or a separate one; whether DB access uses the service-role key (RLS bypass); app-layer vs DB-layer auth; any public unauthenticated endpoint reaching the DB; secret locations. The CRM holds seller/buyer contact data, so this is a real gap to close before publishing any trust claim that covers it.]`

### 1f. Third-party chain

| Service | Data received | HQ / processing |
|---|---|---|
| DeepSeek | LLM prompts: buyer briefs, questions, product data, seller memories | China (Hangzhou) |
| Coinbase CDP facilitator | Signed USDC transfer authorizations, wallet addresses, amounts | USA |
| Resend | Transactional email incl. recipient email + physical shipping address | USA |
| Supabase | The database of record | US company; project region `[GAP]` |
| Vercel | Frontend + serverless hosting, request logs | USA |
| Thirdweb | Human wallet creation (email/social) | USA |
| Hetzner | Seller-agent runtime VPS | Germany |
| NOSTR relays | Redacted demand teasers, offer receipts (public) | Global public relays |

DPAs: `[GAP: no data-processing agreement found in code or docs with any subprocessor.]` DeepSeek being China-HQ and receiving free-text buyer/seller content is the most material item for a Southeast Asia seller base.

### 1g. Incident response

No `security.txt`, no `/privacy`, `/terms`, `/trust`, or `/security` route, no documented breach process, no security contact in code. Corporate entity is VIA Labs Pte. Ltd., Singapore; the working contact is richard@entrepot.asia. Background: a 2026-07-01 key exposure in a sibling repo led to rotating the shared Supabase legacy JWT keys, so a rotation reflex exists in practice, but there is no written incident-response or seller-notification procedure. `[GAP: no documented breach-notification process or security contact page.]`

---

## STEP 2 — Gap table

| Gap | Severity | Recommended fix |
|---|---|---|
| No self-service seller revocation and no data-deletion path; only a superadmin can deactivate | High | Add a seller-authenticated deactivate + delete-my-data route; define what persists (on-chain records are immutable) |
| Superadmin is one shared `ADMIN_SECRET` with no per-operator identity or audit trail; service-role key can read all seller/buyer data | High | Per-operator admin identities, log every admin action with the operator id, scope reads |
| No retention policy; `app_mcp_interactions` stores full request/response jsonb indefinitely, may include buyer free-text/contact | High | Set a TTL + cron purge; redact PII fields before write |
| No published privacy/trust page, no security contact, no breach-notification process | High | Publish this trust page + a `security.txt` + a written breach process with a notification SLA |
| Supabase region and backup posture not verifiable from code (data residency unknown for a SEA market) | Medium | Confirm and publish the region; document backup cadence/retention |
| CRM (`crm.getvia.xyz`) trust posture unaudited this run; it holds seller/buyer contact data | Medium | Finish the CRM audit: Supabase linkage, service-role usage, auth on every endpoint |
| DeepSeek (China-HQ) receives buyer/seller free-text with no DPA on record | Medium | Sign a DPA or document the transfer basis; consider a regional or self-hosted model for SEA data |
| No DPAs on record with any subprocessor | Medium | Execute DPAs with Supabase, Resend, Coinbase CDP, Vercel, Thirdweb; publish a subprocessor list |
| Shopify Storefront token stored encrypted but the scheme is not in via-app source | Medium | Verify the token encryption key/algorithm and document it |
| Public unauthenticated MCP by design; rate limiting is per-warm-instance best-effort only | Low | Document the choice; add a global/distributed rate limit if abuse appears |
| Dormant `mem0.ts` present but unused | Low | Delete to avoid future confusion about data flows |

Corrected non-findings (stated so they are not re-raised): secrets are **not** in version control. `.env.local` is gitignored and untracked; only `.env.example` is committed (verified with `git ls-files`). `mem0` is not an active data flow.
