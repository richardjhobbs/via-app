# SBW Ticketing — Execution & Build Plan

Status: GO (approved for build, 2026-06-26). Branch: `claude/sbw-ticketing-plan`.

Companion to the partner-facing pitch "Singapore Blockchain Week x VIA: Partnership
Proposal" (Notion). That page is what SBW reads. This page is what we build from.

## Build status (2026-06-26)

Landed on the branch (typechecks clean, test suite green; NOT yet deployed):

- **Phase A, voucher core, DONE.** `migrations/0031_voucher_codes.sql` (pool table +
  atomic `app_claim_voucher` RPC), `lib/app/vouchers.ts`, voucher branch in
  `app/api/x402/purchase/route.ts` (claim + inline `vouchers` + buyer email),
  `sendTicketDeliveryEmail` in `lib/app/email.ts`, oversell guards in both the web
  order route and the MCP `buy_product`, email capture + code display in
  `CheckoutBox.tsx`, and `is_voucher` on `PublicProduct`.
- **Phase C, event template, DONE (code).** `scripts/provision-event.mjs` +
  `events/sbw-2026.json` (placeholder values flagged for SBW).

Remaining operator steps (irreversible / outward, held for explicit go):

1. Apply `migrations/0031_voucher_codes.sql` to the live Supabase project.
2. `vercel --prod` deploy (run `tsc --noEmit` first; it is currently clean).
3. `node scripts/provision-event.mjs events/sbw-2026.json --enable` to stand up the
   SBW store, then load a test code batch and run an end-to-end buy (Phase E).

Not yet built (next): Phase B admin CSV upload control in the seller products UI
(the provisioning script's `--codes` flag covers the operator path meanwhile);
Phase D optional embeddable concierge widget.

## Goal

A full, live proof of execution: VIA as a **ticketing / event channel for agents**.
An AI buying agent (or a human) discovers the Singapore Blockchain Week store on VIA,
buys a pass priced in USDC, settles on Base through the x402 door, and receives a
unique redemption code (a Luma voucher) — with 97.5% paid out to SBW instantly and
SBW changing nothing in their existing Luma flow.

Two hard constraints shape every decision below:

1. **Reuse the built framework with as few adjustments as possible.** A ticket is a
   digital good. The store, the catalogue, the x402 settlement, the 97.5% payout, the
   mint-on-sale, the per-seller concierge, and signed delivery already exist. We add
   the *one* thing tickets need that digital files don't: a per-buyer unique code.
2. **Make it repeat-deployable.** SBW is event #1, not a one-off. Everything
   event-specific lives in a single config file fed to a provisioning script. The
   next event is a new config file, not new code.

## What already exists and is reused unchanged

| Capability | Where | Note |
|---|---|---|
| Store / seller (the "event") | `lib/app/store-registration.ts`, `app_sellers` | The event = one seller store. Agent wallet + ERC-8004 identity provisioned automatically on approve. |
| Catalogue products (the "tiers") | `app_seller_products`, `lib/app/via-product.ts`, `publish-product.ts` | Each pass tier = one product. `price_minor` (USDC 6dp), `stock`, `max_supply`, `metadata`. |
| Per-seller MCP for agents | `app/sellers/[slug]/mcp/route.ts` | `list_products`, `get_product`, `ask_sales_agent`, `buy_product`, `get_download_*`. The agent buying surface ships as-is. |
| x402 paid door + settlement | `lib/app/x402-gate.ts`, `x402-server.ts`, `app/api/x402/purchase/route.ts` | Both x402 permit and direct-USDC paths. All funds land on the platform wallet first. No changes. |
| Human checkout | `app/sellers/[slug]/products/[id]/CheckoutBox.tsx` + `.../order` route | Wallet or card (thirdweb Pay on-ramp) → same `/api/x402/purchase` settlement as agents. |
| 97.5% / 2.5% split + auto-payout | `lib/app/splits.ts`, `auto-payout.ts` | `insertDistributionAndPay`. Held until store active, released on approve. No changes. |
| Mint-on-sale (ERC-1155 receipt) | `app/api/x402/purchase/route.ts` `registerDropAtSale` | Buyer gets an on-chain receipt of the pass purchase. No changes. |
| Concierge ("Hermes") | `lib/app/sales-agent.ts`, `app/admin/.../sales-agent`, concierge API routes | DeepSeek sales agent, trained by admin chat into `app_seller_memories`; answers buyers via `ask_sales_agent`. Reused; we seed its memories from event config. |
| Signed private delivery | `lib/app/digital-delivery.ts` (`app-digital-assets` bucket) | Entitlement gate is an entitling `app_purchases` row. We extend the *content* of delivery, not the gate. |
| Order recording + buyer contact | `app_purchases` (`delivery_address` jsonb, `order_ref`) | Email + name captured in `delivery_address`. No schema change. |

## The single real gap: per-buyer unique codes

Today digital delivery signs URLs to the **product's shared file set** — correct for an
ebook, wrong for a ticket, where buyer A and buyer B must each get a **different** Luma
code and no buyer ever sees another's. So the one new primitive is a **voucher-code
pool** with an **atomic claim at settlement**.

### New table (one migration)

```sql
create table app_voucher_codes (
  id                   uuid primary key default gen_random_uuid(),
  seller_id            uuid not null references app_sellers(id),
  product_id           uuid not null references app_seller_products(id),
  code                 text not null,
  status               text not null default 'available'
                         check (status in ('available','claimed','void')),
  claimed_by_purchase  uuid references app_purchases(id),
  claimed_at           timestamptz,
  created_at           timestamptz not null default now(),
  unique (product_id, code)              -- no duplicate codes per tier
);
-- fast "next available" + restock counting
create index app_voucher_codes_available
  on app_voucher_codes (product_id) where status = 'available';
```

### Atomic claim (one RPC, concurrency-safe)

```sql
create or replace function app_claim_voucher(p_product_id uuid, p_purchase_id uuid)
returns text language plpgsql as $$
declare v_id uuid; v_code text;
begin
  select id, code into v_id, v_code from app_voucher_codes
   where product_id = p_product_id and status = 'available'
   order by created_at
   for update skip locked        -- two concurrent settlements never grab the same code
   limit 1;
  if v_id is null then return null; end if;   -- pool empty → sold out
  update app_voucher_codes
     set status='claimed', claimed_by_purchase=p_purchase_id, claimed_at=now()
   where id = v_id;
  return v_code;
end $$;
```

### Settlement injection (one block, in the existing route)

In `app/api/x402/purchase/route.ts`, where it currently signs `download` links
(the `kind === 'digital'` block, ~L414), add a voucher branch:

- If the product is a **voucher product** (`metadata.voucher = true`), then for an
  order that has reached an entitling status, claim `qty` codes via `app_claim_voucher`
  bound to `purchase.id`.
- **Idempotency:** before claiming, look up codes already `claimed_by_purchase = purchase.id`
  and return those instead of claiming more (re-POST / recovery returns the same codes).
- Surface the codes in the settlement response (`vouchers: [{ code, redemption }]`) AND
  via the existing `download`/delivery channel so both the agent path and the human
  `CheckoutBox` "Purchase complete" panel render them.
- Fire the buyer email (below). All of this is **non-fatal**: payment already settled,
  so a hiccup logs and the code stays claimable on `get_download_links` retry.

### Buyer email (reuse `lib/app/email.ts`)

On settlement, email the buyer their code(s) + the event's redemption instructions, to
the address captured in `delivery_address.email`. The proposal promises "their email is
captured" — this is where it is used. Idempotent on `order_ref`.

### Stock = remaining pool

Tier stock displayed to agents/humans is `count(app_voucher_codes where available)`.
When it hits zero the tier reads sold out (reuse `on_chain_status`/`stock` surfacing).
Loading more codes restocks it automatically — no other action.

That is the entire net-new surface: **1 table, 1 RPC, 1 settlement block, 1 email,
1 admin upload control.** Everything else is configuration.

## Repeat-deployable: the event template

Event-specific data lives in `events/<slug>.json`; a provisioning script turns it into
a live store. The next event is a new JSON file.

### Config shape (`events/sbw-2026.json`)

```jsonc
{
  "slug": "singapore-blockchain-week",
  "name": "Singapore Blockchain Week 2026",
  "concierge_name": "Hermes",
  "website": "https://...",
  "payout_wallet": "0x...",            // SBW's USDC wallet (97.5% lands here)
  "redemption": {
    "platform": "luma",
    "instructions": "Redeem your code at https://lu.ma/<event> — enter it at checkout to claim your pass."
  },
  "concierge_facts": [                  // seeded into app_seller_memories
    { "type": "event",  "title": "Dates & venue", "body": "..." },
    { "type": "policy", "title": "Refunds",       "body": "..." }
  ],
  "tiers": [
    { "key": "visitor",   "title": "Visitor Pass",   "price_usdc": 50,  "allocation": 100, "includes": "..." },
    { "key": "general",   "title": "General Pass",    "price_usdc": 150, "allocation": 200, "includes": "..." },
    { "key": "corporate", "title": "Corporate Pass",  "price_usdc": 400, "allocation": 50,  "includes": "..." },
    { "key": "pro",       "title": "Pro Pass",        "price_usdc": 800, "allocation": 30,  "includes": "..." },
    { "key": "vip",       "title": "VIP Pass",        "price_usdc": 1500,"allocation": 10,  "includes": "..." }
  ]
}
```

### Provisioning script (`scripts/provision-event.mjs <config.json>`)

Idempotent (safe to re-run as details firm up):

1. Upsert the seller store (`createPendingAgentStore` → approve, or direct insert) with
   `kind='service'`, brand persona named after `concierge_name`, website, payout wallet.
2. Upsert one product per tier: `title`, `price_minor = price_usdc * 1e6`,
   `stock = allocation`, `metadata.voucher = true`, `metadata.redemption`,
   `metadata.via_enrichment` (agent-facing prose from `includes`).
3. Seed `app_seller_memories` from `concierge_facts` + a generated tier/price summary so
   the concierge can answer "what tiers, what's included, how do I redeem".
4. Leave products as drafts — mint-on-sale registers the drop at first purchase, so we
   mint only what sells.
5. Print the agent MCP URL and the public store URL for handoff.

Voucher codes are loaded separately (admin upload or `--codes tier=path.csv`), because
SBW provides them on their schedule and we want the store standable before codes exist.

## Build phases

Each phase ends green on `tsc --noEmit` (Turbopack is stricter) and is independently
shippable via `vercel --prod`.

- **Phase A — Voucher core (the only real code).** Migration (`app_voucher_codes` + RPC),
  settlement injection in `/api/x402/purchase`, email on settlement, stock-from-pool.
  Unit-test the claim under concurrency (no double-allocation, idempotent re-POST).
- **Phase B — Admin code upload.** Per-tier CSV upload control in the seller products
  admin → inserts into `app_voucher_codes`; show "codes remaining". (Operator can also
  use the provisioning script's `--codes` flag in the interim.)
- **Phase C — Event template + SBW config.** `scripts/provision-event.mjs` +
  `events/sbw-2026.json`. Stand up the SBW store on a test config, run an end-to-end
  buy (agent path and human `CheckoutBox`) with a test code batch.
- **Phase D — Concierge polish.** Confirm `ask_sales_agent` answers tiers/redemption
  from seeded memories; tune the SBW persona. (Optional: a drop-in embeddable concierge
  widget for SBW's website — the agent MCP endpoint already exists; the JS embed does
  not and is the only frontend net-new if SBW wants the on-site concierge.)
- **Phase E — Dry run & go-live.** Test batch end-to-end for SBW review (per the
  proposal's "Next steps"), then load the real allocation + codes and open the store.

## Inputs needed from SBW (tracked, not blocking the build)

Per the proposal's "Next steps": confirmed per-tier USDC prices and VIA allocation;
batch-generated Luma redemption codes per tier + the redemption instruction text; SBW's
USDC payout wallet on Base. The store and code-pool stand up before these land; they slot
into the config and the admin upload.

## Invariants to respect (from CLAUDE.md)

- No em/en dashes in any user-facing copy under `app/`, `lib/`, `components/`.
- Seller agent wallet is always platform-derived (`deriveAgentWallet`); the event store
  is a seller, so this holds automatically.
- Paid-door invariant: the x402 door stays the single paid choke point. Tickets buy
  *through* it (the purchase settlement), so the invariant is preserved — there is no new
  free full-value surface.
- Run `tsc --noEmit` before any deploy. Update the Notion Build Log after each deploy.
```
