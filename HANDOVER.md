# VIA pivot , handover pointer (2026-06-15)

This repo is mid-pivot from index-search matching to a broadcast / x402 offer
exchange. The authoritative handover lives in memory and the plans dir:

1. **Auto-loaded memory (read first):**
   - `~/.claude/projects/C--Users-Richard-Documents-via-app/memory/project_via_handover_state.md`
     , LIVE deployed state + the 4 urgent open bugs.
   - `~/.claude/projects/C--Users-Richard-Documents-via-app/memory/project_via_matching_architecture.md`
     , the locked architecture (see its CORRECTION section).
2. **Full plan + detailed handover (not auto-loaded):**
   - `~/.claude/plans/stop-atomic-flurry.md` , the phased plan.
   - `~/.claude/plans/via-handover-2026-06-15.md` , detailed session handover.

TL;DR urgent bugs 1-4 (crash, hoodie recall, `adapt`, store-name-as-product): ALL
FIXED + verified live + deployed to the Box on 2026-06-15. The seller agent now reads
each seller's OWN MCP `list_products` (the enhanced-data surface), NEVER the federation
`/api/via/search` (a thin UI-visible projection that hid Unknown Union's hoodies: 10
shown vs 86 in MCP). Do NOT reintroduce search-shaped sourcing. Details +
verification + Box run/deploy commands in `project_via_handover_state.md`.

Still open: Phase 4 (x402 micro-fee on the door + ERC-8004 both-agent signal queue),
Phase 5 (seller credits), full vinyl Discogs backfill, cancel vinyl-junkie's 10 stale
TEST briefs. via-app app/lib deploys via `vercel --prod` (`tsc --noEmit` first); the
Box seller agent deploys via `scp scripts/seller-agent.mjs 100.80.225.34:via-seller-agent.mjs`.
