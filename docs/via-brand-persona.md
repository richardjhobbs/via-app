# VIA brand persona , the federated seller-identity contract

## What it is

`brand_persona` is the one piece of identity a Sales Agent reasons with before it
decides anything: who the brand is, what it makes, who it is for, and its vibe.
Without it, a concierge judges a buyer brief from product-name strings alone and
misses obvious matches (a motor-rally brand offered nothing on "a gift for someone
into cars and rallying" because it never knew it was a rally brand).

It is a **network standard**, not a platform feature. Every member platform
(VIA, RRG, and any future partner) exposes the same field the same way, so the
shared seller agent works across all of them with zero per-platform code.

## The contract

A member platform's **per-seller MCP** returns a `brand_persona` string at the top
level of its `list_products` response, alongside `products`:

```jsonc
{
  "brand_persona": "Gumball 3000 is a British lifestyle brand built around the annual 3,000-mile international motor rally founded in 1999 by Maximillion Cooper. Apparel, headwear, accessories...",
  "products": [ /* ... */ ]
}
```

- **Type:** string. Plain prose, no fixed schema. A few sentences is ideal.
- **Absent or empty:** allowed. The agent falls back to the seller's name. Matching
  still works, just with less to reason from.
- **Source is the platform's own brand data.** It is not buyer-supplied and never
  mixed with buyer intent.

## How the agent uses it

`scripts/seller-agent.mjs` reads `brand_persona` once per seller per pass and injects
it into both decision steps:

- **`shouldBid`** (the paid self-select on the free teaser): the seller judges the
  teaser as its brand, so a rally brand pays to unlock a rally-gift brief and a
  bakery does not. Better self-selection, less wasted unlock spend, and the paid
  teaser surface is unchanged.
- **`decide`** (offer ranking on the unlocked brief): for a specific brief (named
  product type / hard requirements) it stays strict; for an interest/theme/gift
  brief it judges through the persona, offering only items genuinely on-brand and
  on-interest, never "this could be a nice gift".

## How each platform fills it

- **VIA** (`app.getvia.xyz/sellers/<slug>/mcp`): composed from `app_sellers.name`,
  `headline`, and `description`. Sellers author it in onboarding (the "Brand persona"
  step) and edit it on the dashboard ("Brand persona" panel). `description` is the
  primary persona text.
- **RRG** (`realrealgenuine.com/brand/<slug>/mcp`): from `rrg_brands.description`.
- **A new partner:** populate `brand_persona` on your seller MCP's `list_products`
  from whatever brand profile you hold. That is the entire integration for this
  feature.

## Onboarding a partner , checklist item

> Your per-seller MCP `list_products` response includes a top-level `brand_persona`
> string describing each seller (identity, what they make, who for, vibe). This is
> what the buyer-facing Sales Agent uses to match your sellers to demand.
