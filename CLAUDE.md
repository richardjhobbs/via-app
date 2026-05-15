# CLAUDE.md — rrg

The main Real Real Genuine product. Next.js 16 App Router, deployed to the Hetzner VPS at 89.167.89.219 (Vercel is preview only). Source of truth for the on-chain platform agent (#33313), per-brand MCP endpoints, all brand storefronts, the marketing outreach pipeline, and the on-chain split logic.

## Read before touching this repo

The authoritative project knowledge lives in `~/.claude/projects/C--Users-Richard-Documents-rrg/memory/`. The single most-referenced files:

- [wallet_separation.md](../../.claude/projects/C--Users-Richard-Documents-rrg/memory/wallet_separation.md) — DrHobbs (#17666) vs RRG (#33313) vs DEPLOYER (#26244) vs VIA Team Wallet. Never mix these.
- [vps_deployment.md](../../.claude/projects/C--Users-Richard-Documents-rrg/memory/vps_deployment.md) — VPS layout, PM2 ids, deploy flow via GitHub Actions, env-var restart procedure, nginx routes.
- [feedback_deploy_push_to_master.md](../../.claude/projects/C--Users-Richard-Documents-rrg/memory/feedback_deploy_push_to_master.md) — when Richard says "push", push to master. The GitHub Action handles VPS build + restart. Do not tell him to merge. Do not mention Vercel.
- [feedback_register_drop_creator_must_be_platform.md](../../.claude/projects/C--Users-Richard-Documents-rrg/memory/feedback_register_drop_creator_must_be_platform.md) — `registerDrop(tokenId, creator, …)` for brand-owned drops MUST pass `PLATFORM_WALLET`, not the brand wallet. Wrong creator = 67.5% platform loss per sale via `mintWithPermit`.
- [merchant_type_rule.md](../../.claude/projects/C--Users-Richard-Documents-rrg/memory/merchant_type_rule.md) — `merchantType` (direct_brand / reseller_authenticated / curated_consignment) drives schema and visibility.
- [SERVICES.md](../../.claude/projects/C--Users-Richard-Documents-rrg/memory/SERVICES.md) — full third-party service inventory (Supabase, Resend, Pinata, Base RPC, Thirdweb, WalletConnect, Telegram/BlueSky/Discord bots, x402, World ID, agentmail, mem0).
- [agent_runtime_topology.md](../../.claude/projects/C--Users-Richard-Documents-rrg/memory/agent_runtime_topology.md) — Box (100.80.225.34) NSSM services, helper scheduled tasks, who runs where.

Other useful pointers: `~/.claude/projects/C--Users-Richard-Documents-rrg/memory/MEMORY.md` is the index.

## Hard rules

- **Push to master to deploy.** GitHub Action SSHes the VPS, `git pull`, `npm ci && npm run build`, `pm2 restart rrg-app`. No manual SCP. Local = GitHub = VPS after every deploy.
- **No em-dashes (`—`) or en-dashes (`–`) in user-facing copy.** Anywhere under `app/`, `lib/`, `components/`. Internal `.md` files are exempt. The pre-commit hook enforces this on staged source files (see Setup below).
- **Run `tsc --noEmit` before any push.** Vercel Turbopack is stricter than the VPS bundler and will reject TS errors the VPS silently passes. The pre-commit hook has this gate wired but disabled until the existing typecheck errors (react-markdown / remark-gfm types, ChatPanel implicit-any) are resolved.
- **Wallet rule** (from [wallet_separation.md](../../.claude/projects/C--Users-Richard-Documents-rrg/memory/wallet_separation.md)): RRG endpoints ALWAYS use `realrealgenuine.com`. NEVER `richard-hobbs.com` for RRG. RRG-Agent #33313 wallet is `0xbfd71eA27FFc99747dA2873372f84346d9A8b7ed`. DrHobbs #17666 wallet is `0xe653804032A2d51Cc031795afC601B9b1fd2c375`. Never cross these.
- **MCP clientInfo** for outbound calls is always `RRG-Agent-33313`, never `DrHobbs-Marketing`.
- **Brand split is flat 97.5% to brand** for direct brand products. Tiered or variable splits are co-creation only ([feedback_brand_split_flat.md](../../.claude/projects/C--Users-Richard-Documents-rrg/memory/feedback_brand_split_flat.md)).
- **Don't infer per-brand wallets from `scripts/brand-mirror.mjs`** — the `wallet:` strings there are stale defaults ([feedback_brand_mirror_wallet_config_not_authoritative.md](../../.claude/projects/C--Users-Richard-Documents-rrg/memory/feedback_brand_mirror_wallet_config_not_authoritative.md)). Read the brand row in `rrg_submissions` instead.
- **`hidden` vs `ui_visible`** are two different visibility flags ([feedback_ui_vs_mcp_visibility.md](../../.claude/projects/C--Users-Richard-Documents-rrg/memory/feedback_ui_vs_mcp_visibility.md)). `hidden` = global kill-switch; `ui_visible` = storefront-only curation, agents still see via MCP. Don't conflate.

## Setup for a new clone

```
npm ci
./scripts/install-hooks.sh   # installs em-dash pre-commit hook
cp .env.local.example .env.local  # then fill in
npm run dev
```

## Architecture in one paragraph

Next.js App Router. `app/api/rrg/*` is the platform API surface. `app/api/brand/[brandId]/*` is brand-side admin. `app/api/agent/*` is the consumer-agent API. `app/mcp/route.ts` is the platform MCP endpoint (`realrealgenuine.com/mcp`); per-brand MCPs live at `app/brand/[slug]/mcp/route.ts`. `lib/rrg/*` is the platform business logic (`splits.ts`, `auto-payout.ts`, `marketing-outreach.ts`, `marketing-discovery.ts`, `erc8004.ts`, etc.); `lib/agent/*` is the consumer-agent runtime (`brain.ts`, `core-prompt.ts`, `credits.ts`, `via-tools-spec.ts`). Production runs as `rrg-app` PM2 process on port 3001, reverse-proxied by nginx.

## Things to NEVER touch without thinking twice

- `lib/rrg/splits.ts` and `lib/rrg/auto-payout.ts` — the on-chain payment routing. Wrong changes mean real USDC loss. See [via_payment_primitive_lessons.md](../../.claude/projects/C--Users-Richard-Documents-rrg/memory/via_payment_primitive_lessons.md) for the seven design lessons from the registerDrop bug.
- `contracts/RRG.sol` — the deployed ERC-1155 contract. Address `0x9F07621f73E7CAaF2040C35833D5350F666b7177` on Base mainnet. Migrations are post-mortems waiting to happen.
- `.env.local` on VPS — `pm2 restart` does NOT pick up env changes. Use the full sequence in [vps_deployment.md](../../.claude/projects/C--Users-Richard-Documents-rrg/memory/vps_deployment.md).

## Notion Build Log

Update after every meaningful deploy ([feedback_update_build_log.md](../../.claude/projects/C--Users-Richard-Documents-rrg/memory/feedback_update_build_log.md)). Phase 34+ continuation page id: `34ddbc7b67f2811690afe320fa579892`. Format spec in [feedback_notion_build_log_format.md](../../.claude/projects/C--Users-Richard-Documents-rrg/memory/feedback_notion_build_log_format.md).
