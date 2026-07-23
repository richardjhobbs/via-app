# CLAUDE.md — via-app

The VIA App at `app.getvia.xyz`: the Stage-1 Sales Agent + Buying Agent product, forked from RRG and turned into a sector-agnostic agentic-commerce surface. Next.js 16 App Router. This is its OWN project, separate from RRG and from the `getvia.xyz` marketing site. Do not assume RRG's rules apply here, the deploy path, wallets, and Supabase project are all different.

## Read before touching this repo

The authoritative project knowledge lives in `~/.claude/projects/C--Users-Richard-Documents-via-app/memory/`. `MEMORY.md` there is the index. Most-referenced:

- [project_via_deploy_topology.md](../../.claude/projects/C--Users-Richard-Documents-via-app/memory/project_via_deploy_topology.md) — app + www `.getvia.xyz` are Vercel; production ships via `vercel --prod`.
- [project_agent_wallet_decoupled_from_thirdweb.md](../../.claude/projects/C--Users-Richard-Documents-via-app/memory/project_agent_wallet_decoupled_from_thirdweb.md) — the AGENT identity/x402 wallet is ALWAYS platform-derived from `AGENT_WALLET_SEED`; Thirdweb only ever the human funding/payout wallet.
- [project_seller_agents_vps_migration.md](../../.claude/projects/C--Users-Richard-Documents-via-app/memory/project_seller_agents_vps_migration.md) — the seller-agent runtime + its deploy mechanism on the VPS.
- [project_supabase_topology.md](../../.claude/projects/C--Users-Richard-Documents-via-app/memory/project_supabase_topology.md) — via-app vs RRG are SEPARATE Supabase projects; cross-platform reads federate over HTTP, never a SQL union.
- [project_paid_door_invariant.md](../../.claude/projects/C--Users-Richard-Documents-via-app/memory/project_paid_door_invariant.md) — VIA has ONE paid choke point (the x402 brief door); no seller-facing surface may give a full brief/pitch/offer/negotiation for free.

## Deploy (this is the real topology, NOT RRG's)

There are TWO independently-deployed things in this repo:

1. **The web app** (`app.getvia.xyz`). Vercel project `via-app` (`prj_jR0cJ2Kwr8IkCbzcF9Q2FuCx7bJX`). Ship with **`vercel --prod`** from the repo root. `vercel.json`'s `ignoreCommand` skips preview builds and builds production. Claude owns this deploy and runs it directly, do not ask the user to deploy. There is no "push to master to deploy" GitHub Action here (that is an RRG rule and does NOT apply).

2. **The standalone seller-agent runtime** on the Hetzner VPS at `agent@89.167.89.219`, living in `/home/agent/apps/via-agents/` (`seller-agent.mjs` + its own `ethers` + `run.sh`, run by system cron every ~10 min). This directory is **NOT a git checkout** and has no CI auto-deploy. The DOCUMENTED, SANCTIONED deploy mechanism is the operator (Claude) copying `scripts/seller-agent.mjs` to it by **scp**, then a `VIA_AGENT_DRY_RUN=1` smoke test over ssh:

   ```
   scp scripts/seller-agent.mjs agent@89.167.89.219:/home/agent/apps/via-agents/seller-agent.mjs
   ssh agent@89.167.89.219 "VIA_AGENT_DRY_RUN=1 /home/agent/apps/via-agents/run.sh"
   ```

   This dir is a plain directory, not a git checkout, so scp is the deploy mechanism (unlike RRG, whose VPS dir is a git checkout with a GitHub-Action deploy, hence RRG's "no manual scp" rule does not apply to it). Full migration brief: `docs/transfer-seller-agents-box-to-vps.md`. `AGENT_WALLET_SEED` + the RRG brand keys must be present in `/home/agent/apps/rrg/.env.local` for the VIA / RRG roster sellers to resolve their keys; placing the seed is the user's hard-walled step.

## Architecture in one paragraph

Next.js App Router at `app.getvia.xyz`. Supabase project `via-agent-mcp` (id `gcxyoujubqclenrhhill`); all Stage-1/2 tables are `app_*`. `app/api/via/*` is the network API; `app/mcp/route.ts` is the network MCP; per-seller MCP at `app/sellers/[slug]/mcp/route.ts`, per-buyer at `app/buyers/[handle]/mcp/route.ts`. `lib/app/*` is the business logic (`store-registration.ts`, `auto-payout.ts`, `agent-wallet.ts`, `agent-funding.ts`, `buyer-identity.ts`, `x402-gate.ts`, the `broadcast/` NOSTR rail). The seller-side reference agent is `scripts/seller-agent.mjs`. LLM is DeepSeek. Identity is ERC-8004 on Base; payments are USDC via x402, settled by the Coinbase CDP facilitator.

## Hard rules

- **No em-dashes or en-dashes in user-facing copy** anywhere under `app/`, `lib/`, `components/`. Internal `.md` files are exempt.
- **Run `tsc --noEmit` before any deploy.** Vercel Turbopack is stricter than local.
- **ALL agent identity wallets = platform-derived** ([project_agent_wallet_decoupled_from_thirdweb.md](../../.claude/projects/C--Users-Richard-Documents-via-app/memory/project_agent_wallet_decoupled_from_thirdweb.md)). Sellers, buyers, and rooms alike hold their ERC-8004 identity token on `deriveAgentWallet(id)` (from `AGENT_WALLET_SEED`), never a Thirdweb wallet. Identities are **self-minted** from that derived wallet (`selfMintAgentIdentity` signs `register()` from it so the token is self-custodied), NOT through the registrar (which would own the token itself). A buyer's Thirdweb in-app wallet (`wallet_address`) is their SPEND wallet only, kept entirely theirs and distinct from the derived identity wallet. Onboarding self-mint seeds identity-wallet gas from the DEPLOYER wallet, so the deployer needs a standing Base ETH float or new mints fail (fail-open, retry from admin). Audit: `node scripts/audit-agent-wallets.mjs` (sellers, buyers, and rooms all checked vs derived).
- **Paid-door invariant** ([project_paid_door_invariant.md](../../.claude/projects/C--Users-Richard-Documents-via-app/memory/project_paid_door_invariant.md)): the x402 brief door is the single paid choke point. Test every new agent-facing surface against it before shipping.
- **Wallet/identity**: brand split is 97.5% seller / 2.5% platform. ERC-8004 mints go through the VIA registrar as `source_platform: 'rrg'` ([project_erc8004_mint_path.md](../../.claude/projects/C--Users-Richard-Documents-via-app/memory/project_erc8004_mint_path.md)).

## Notion Build Log

Update after every meaningful deploy. New entries are Phase-numbered (`## Phase N - Title (D Month YYYY)`), ascending, appended at the END of the current rolling page. The active page is "Build Log — Stage 1 + Superadmin (Phase 11+)" (id `384dbc7b67f281538378e4a8bacc9f79`) under the "VIA APP" parent; it currently runs through Phase 74. Earlier entries live on the archived "Build Log — Stage 1 + Superadmin (Phases 1-10, through 2026-06-02)" (id `36fdbc7b67f28170a3ddf14c4e6d2d07`). Roll over to a new "(Phase N+)" page when the active one gets long. Do NOT use the RRG build-log pages for via-app work.
