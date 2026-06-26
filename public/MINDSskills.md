# VIA - Email shopping-preference appraisal (Minds skill)

This is the contract for the `via.concierge` Mind (or any buyer's own Mind on
hellominds.ai) to read a user's email, appraise how they shop, and set up their
VIA buying agent so it can source, negotiate, and buy on their behalf.

VIA never receives the raw email. The reading and the appraisal happen INSIDE the
Mind; only the structured appraisal below crosses to VIA.

## What the skill does

1. The user mints a **link token** in their VIA dashboard and pastes it to the Mind.
2. The Mind scans the user's inbox (order confirmations, receipts, shipping
   notices, wishlists, newsletter signals) and produces a **PreferenceAppraisal**.
3. The Mind sends the appraisal to VIA with the link token.
4. VIA imports the taste signals onto the buying agent immediately and stashes the
   budget as a **proposed spending cap** the user approves in their dashboard.
5. From then on the buying agent uses this profile to source (`submit_intent`),
   judge offers, negotiate, and auto-buy within the approved caps.

## Getting the link token

The user, logged into their VIA dashboard, mints a short-lived token:

```
POST https://app.getvia.xyz/api/buyer/{buyerId}/appraisal
Body: { "action": "mint_link" }
-> { "link_token": "<token>", "expires_in_seconds": 86400 }
```

The token scopes the Mind to exactly that one buying agent for 24 hours. The user
pastes it into the Mind. No wallet signature or VIA login is needed on the Mind side.

## Sending the appraisal

Either route works , use whichever your runtime supports.

**MCP (recommended):** connect to `https://app.getvia.xyz/mcp` and call the
`import_preference_appraisal` tool with `{ link_token, appraisal }`.

**REST:**

```
POST https://app.getvia.xyz/api/buyer/import-appraisal
Body: { "link_token": "<token>", "appraisal": { ...PreferenceAppraisal } }
```

## PreferenceAppraisal schema

```jsonc
{
  "categories": [
    { "category": "denim", "affinity": 0.9, "typical_price_usd_low": 120, "typical_price_usd_high": 300 }
  ],
  "brands_liked":   ["Iron Heart", "3sixteen"],
  "brands_avoided": [],
  "sizes":          { "waist": "32", "shoe_eu": "43" },
  "purchase_cadence": "occasional",          // "frequent" | "occasional" | "rare"
  "budget_signal": {
    "monthly_spend_usd_estimate": 200,
    "single_item_ceiling_usd": 350
  },
  "notable_recent_purchases": [
    { "category": "denim", "item": "raw selvedge jeans", "price_usd": 280, "when": "2026-05" }
  ],
  "confidence": 0.75,                          // 0-1, your confidence in the appraisal
  "evidence_summary": "Buys raw denim and workwear a few times a year, repeat orders from Japanese makers, single items typically 150-350 USD."
}
```

All fields are optional except that you should send at least `categories` or a
`budget_signal` for the import to be useful.

### Hard privacy rule

`evidence_summary` is prose ONLY. Never put raw quoted email content, addresses,
order numbers, or other PII anywhere in the appraisal. Summarise; do not transcribe.

## How VIA maps it

- `categories` -> a soft **preference** memory (shapes matching, does not gate spend).
- `brands_liked` / `brands_avoided` -> **brand_affinity** memories.
- `sizes` -> a **constraint** memory.
- `purchase_cadence` -> a general note.
- `budget_signal.single_item_ceiling_usd` -> a **proposed** `max_purchase_usd` cap
  (and a conservative `auto_buy_under_usd` when confidence is high). Proposed caps do
  NOT take effect until the user approves them in the dashboard.

Re-sending an appraisal for the same buyer updates the existing signals in place
(idempotent), so the Mind can re-appraise periodically to keep the profile current.

## What to tell the user

After a successful import, point the user at their dashboard to review the imported
preferences and approve the proposed spending caps (`review_url` is in the response).
Until they approve, the agent will source and judge with the imported taste but will
not auto-buy under the new caps.
