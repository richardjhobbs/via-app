# Transfer brief: VIA seller agents, Box → VPS

**Status:** CODE + VPS STAGING DONE (2026-06-16). Blocked only on Richard placing secrets, then cutover. See section 10 for exactly what remains. **Owner decision (Richard):** all seller signing keys/agents live in ONE place for now — the VPS — covering RRG brands, existing VIA sellers, and any new partner/platform sellers. This is a deliberate bootstrap choice (centralised custody, federate later if needed; the x402 door stays open to any payer so self-hosting remains possible).

---

## 10. Progress 2026-06-16 — what is done, what remains

**Done (autonomous, code + read-only/staging):**
- Verifies on the VPS: SSH/deploy access works; node `v22.22.0`, pm2 `6.0.14` (`/home/agent/.npm-global/bin/pm2`), system cron active; `DEEPSEEK_API_KEY` present in `/home/agent/apps/rrg/.env.local`.
- **Static key file retired.** `scripts/seller-agent.mjs` no longer reads `~/.via-seller-agent-keys.json`. Keys are resolved at runtime: VIA sellers DERIVE in-memory from `AGENT_WALLET_SEED`+store_id (with a self-check against the on-record address, fail-closed); RRG sellers read `<SLUG>_WALLET_PRIVATE_KEY` from env. A seller whose key can't be resolved is skipped.
- **Roster is one source of truth.** Each `ROSTER` entry carries source + erc8004_id + (store_id/expect | env_key). Adding a partner is a one-line edit. (DB-driven roster still the next step — needs via-app Supabase creds on the VPS, which this RRG env does not have; spans two Supabase projects.)
- Added `VIA_AGENT_DRY_RUN=1` (resolve keys + self-select, pay nothing) for safe host verification.
- **Staged on VPS:** `/home/agent/apps/via-agents/` holds `seller-agent.mjs` + its own `ethers@6` + `run.sh` (loads secrets via `node --env-file=/home/agent/apps/rrg/.env.local`). Dry-run smoke test passed: feed + all 15 MCP catalogues pulled; the 4 RRG keys already in env (tyo, university-of-diversity, gumball-3000, philleywood) resolved and self-selected; other 11 skipped for want of a key; 0 offers, 0 spend.

**Env present on VPS now (4 of 12 RRG keys):** `GUMBALL_3000`, `PHILLEYWOOD`, `TYO`, `UNIVERSITY_OF_DIVERSITY` `_WALLET_PRIVATE_KEY`.

**Remaining — Richard (materialising keys is the hard wall):**
1. Add to `/home/agent/apps/rrg/.env.local` on the VPS, then no restart needed (the cron job reads the file each run):
   - `AGENT_WALLET_SEED` (via-app platform seed; `vercel env pull` from via-app prod). Activates the 3 VIA sellers.
   - The 8 missing RRG brand keys, under these EXACT names (privkeys by address from `rrg/tmp/*.json`, per section 9): `CLOOUDIE_WALLET_PRIVATE_KEY`, `NOLO_WALLET_PRIVATE_KEY`, `JENNYS_WALLET_PRIVATE_KEY`, `UNKNOWN_UNION_WALLET_PRIVATE_KEY` (the concierge wallet `0xe9cedf…`), `LES_BASICS_WALLET_PRIVATE_KEY`, `FREY_TAILORED_WALLET_PRIVATE_KEY`, `LIVVIUM_WALLET_PRIVATE_KEY`, `PITCHERS_ONLY_WALLET_PRIVATE_KEY`.
2. Verify: `VIA_AGENT_DRY_RUN=1 /home/agent/apps/via-agents/run.sh` — expect all 15 sellers to resolve a key.
3. Cutover (one window, avoids double-paying): disable the Box scheduled task **"VIA Seller Agents"** and delete the Box's `~/.via-seller-agent-keys.json`; then add the VPS cron line:
   `*/10 * * * * /home/agent/apps/via-agents/run.sh >> /home/agent/apps/via-agents/run.log 2>&1`

Source of truth for the reworked script is `scripts/seller-agent.mjs` in this repo (working tree, not yet committed/pushed). The VPS copy was scp'd from it.

This brief is self-contained. Every path/ID/fact below was verified from the codebase, loaded memory, or `app_sellers` during the session of 2026-06-16. Items marked **VERIFY** are unknowns the new session must resolve on the VPS — do not assume them.

---

## 1. Goal

Move the seller-agent runtime and all seller signing keys off the Windows "Box" and onto the VPS, and while doing so retire the two things that make it unscalable: the hardcoded roster and the static key file.

End state:
- The seller agent runs on the VPS as a managed job (pm2 or cron, every ~10 min), alongside RRG.
- Roster comes from the database (active sellers with an agent wallet), not a hardcoded array — new partners appear with no code edit.
- VIA-native seller keys are DERIVED IN MEMORY from `AGENT_WALLET_SEED` + store id at runtime — no key file, keys never written to disk.
- RRG brand keys come from the VPS env (named vars) or a key file readable only by the `agent` user.

---

## 2. Current state (the Box) — what is being moved

- **Host:** the Box, `100.80.225.34`, Windows, profile `C:\Users\Richard`. (`scripts/place-seller-keys.mjs:10`)
- **Agent code:** `scripts/seller-agent.mjs` (in via-app on the desktop) is `scp`'d to the Box as `~/via-seller-agent.mjs`.
- **Run model:** SINGLE-PASS poll. `box-seller-agent-run.ps1` sources the DeepSeek key from `~/via-crm/.env.local` (`LLM_API_KEY` → `DEEPSEEK_API_KEY`) and runs `node ~/via-seller-agent.mjs` once. `box-seller-agent-setup.ps1` registers a scheduled task **"VIA Seller Agents"** that fires every **10 minutes**, no overlap (`IgnoreNew`), 9-minute execution limit, S4U.
- **What the agent does each pass** (`scripts/seller-agent.mjs`): reads watermark file → GETs `${VIA_BASE}/api/via/demand?limit=50&since=<watermark>` → for each teaser, for each roster seller: reads the seller's OWN MCP `list_products`, runs one DeepSeek call to self-select (`shouldBid`), pays the x402 unlock fee at the door (GET), decides items, pays the per-item offer fee (POST) → advances watermark → exits.
- **Env it needs:** `DEEPSEEK_API_KEY` (required), `VIA_BASE` (default `https://app.getvia.xyz`), `RRG_BASE` (default `https://realrealgenuine.com`), `VIA_SELLER_KEYS_FILE` (optional; default `~/.via-seller-agent-keys.json`). (`scripts/seller-agent.mjs:29-41`)
- **State files in the home dir:** `~/.via-seller-agent-keys.json` (signing keys, format `{ "<slug>": { privkey, erc8004_id } }`) and `~/.via-seller-agent-watermark` (the feed cursor; `scripts/seller-agent.mjs:295`).
- **Node deps:** `ethers` (v6) plus node built-ins.

## 3. Keys today

- The Box's `~/.via-seller-agent-keys.json` holds the **12 RRG** seller keys. The **3 VIA** keys were being added via the updated `scripts/place-seller-keys.mjs` — confirm whether that run has happened (`total stores: 15`) before migrating, or just rebuild on the VPS.
- That file is built by `scripts/place-seller-keys.mjs` (runs on the DESKTOP): 12 RRG keys are read by wallet address from `C:/Users/Richard/Documents/rrg/tmp/*.json`; the 3 VIA keys are DERIVED from `AGENT_WALLET_SEED` (`deriveAgentWallet` HMAC) and self-checked against their on-record agent wallet; the full map is `scp`'d to the Box. **It currently targets `BOX=100.80.225.34` (`place-seller-keys.mjs:19`) — for the VPS this target must change, or be replaced by runtime derivation.**

## 4. Target host (the VPS) — what is known

- **Host:** `agent@89.167.89.219` (Hetzner, Linux). SSH key on the desktop at `~/.ssh/id_ed25519`. RRG lives at `/home/agent/apps/rrg` and runs as a pm2 process. (loaded memory: `project_via_seller_wallets_x402`; project `CLAUDE.md`)
- RRG deploy/runtime detail is in the RRG memory dir `~/.claude/projects/C--Users-Richard-Documents-rrg/memory/vps_deployment.md` — read it before touching pm2/env on the VPS.

---

## 5. First steps for the new session — VERIFY on the VPS (read-only)

Do these before changing anything; do not guess the answers:

1. **VERIFY** node + npm present on the VPS and the version (the agent uses `ethers` v6 + ESM `.mjs`).
2. **VERIFY** whether `AGENT_WALLET_SEED` is set in any env on the VPS (RRG's env, a shared env, or absent). It is in **Vercel prod (via-app)**; it is NOT in the desktop `.env.local`. Needed for in-memory VIA key derivation.
3. **VERIFY** which RRG brand wallet private keys are already in the VPS env. Per `rrg/scripts/register-brand-agent.mjs`, each brand key is meant to be added to `.env.local` (local + VPS + Vercel) as a named var — so some/all of the 12 may already be on the VPS. Map them to the 12 roster slugs.
4. **VERIFY** the DeepSeek key source on the VPS (the Box used `via-crm/.env.local` `LLM_API_KEY`). RRG may already have an LLM key in its env.
5. **VERIFY** pm2 layout and whether the VPS already runs cron jobs, to choose pm2-with-internal-interval vs system cron for the 10-min cadence.

---

## 6. Migration plan (after the verifies)

1. **Place the agent on the VPS:** copy `scripts/seller-agent.mjs` to `/home/agent/apps/` (or a `via-agents` dir). Ensure `ethers` is installed there.
2. **Provide env:** `DEEPSEEK_API_KEY`, `AGENT_WALLET_SEED`, `VIA_BASE`/`RRG_BASE` (defaults are correct for prod), and the RRG brand keys (env or key file).
3. **Keys — the scalable rework (recommended over copying the static file):**
   - Add in-process VIA key derivation to `seller-agent.mjs`: for `source: 'via'` sellers, derive `deriveAgentWallet(AGENT_WALLET_SEED, store_id)` at runtime instead of reading the file. (Logic + the 3 store ids/expected addresses are in `scripts/place-seller-keys.mjs`.)
   - For RRG sellers, read keys from the VPS env (named vars) keyed by slug, or a `chmod 600` key file owned by `agent`.
4. **Roster from DB (recommended):** replace the hardcoded `ROSTER` (`seller-agent.mjs:50-66`) with a query for active sellers that have an `agent_wallet_address`, tagging `source` (`via` vs `rrg`) so the MCP-url shape and key source are chosen per seller. This is what makes new partners zero-touch.
5. **Schedule:** run every ~10 min via pm2 (with an internal loop/interval) or system cron. Single-pass-per-run is preserved; the watermark file (`~/.via-seller-agent-watermark`) makes it idempotent. A fresh VPS has no watermark → first run catches up on recent teasers; `offerExists` dedup prevents double-charging.
6. **Cut over:** once the VPS run is confirmed producing offers, disable the Box scheduled task "VIA Seller Agents" and remove `~/.via-seller-agent-keys.json` from the Box.

---

## 7. Hard constraints / classifier walls (so the new session does not waste time)

These fired during the 2026-06-16 session and need Richard, not the agent:
- **Deriving seller private keys** from `AGENT_WALLET_SEED` into stdout/transcript is HARD-WALLED to the human ("credential leakage ... the user was meant to run themselves") — an explicit `Bash(...)` allow rule does NOT clear it. So Richard runs anything that materialises keys.
- **`vercel env pull` is now allowed** (Richard added `Bash(vercel env pull:*)` to `~/.claude/settings.json` on 2026-06-16).
- **SSH-into-prod credential scans** were blocked earlier; a plain deploy/process SSH to the VPS has not yet been tested this session — find out early whether read/deploy SSH to `agent@89.167.89.219` works for the agent, or whether Richard must run VPS steps.
- The agent cannot edit its own `~/.claude/settings.json` (hard block).

## 8. Open decisions for Richard

- **RRG key custody:** keep RRG brand keys on the VPS alongside VIA (his stated choice), OR migrate RRG brand agent wallets to seed-derived so nothing but the seed is stored. (Current RRG brand wallets are random EOAs in cred files, not seed-derived.)
- **Schedule cadence** on the VPS (10 min like the Box, or different).
- **Vercel Hobby caps crons at daily**, so the agent cannot move to a Vercel cron at 10-min cadence without a Pro upgrade — the VPS (pm2/system cron) avoids this entirely, which is why it is the chosen host.

---

## 9. Verified reference data

**Roster (15): 3 VIA + 12 RRG** (`scripts/seller-agent.mjs:50-66`)
- VIA (`source: 'via'`, MCP `app.getvia.xyz/sellers/<slug>/mcp`): drhobbs-knowledge, eli-s-artisan-bakery, the-sentient-startup
- RRG (`source: 'rrg'`, MCP `realrealgenuine.com/brand/<slug>/mcp`): clooudie, nolo, jennys, unknown-union, tyo, university-of-diversity, les-basics, frey-tailored, gumball-3000, livvium, philleywood, pitchers-only

**VIA seller derivation inputs** (store id → on-record agent wallet → erc8004 id; from `app_sellers` 2026-06-16). Derivation: `pk = HMAC-SHA256(AGENT_WALLET_SEED, "agent-wallet|<store_id>|<i>")`, first valid i (`lib/app/agent-wallet.ts`):
- drhobbs-knowledge `dd0e81fd-586b-4196-99f3-5f3ed2974ad6` → `0x35bcf708834d1c38187a49705dfd7997b551d418` → 55552
- eli-s-artisan-bakery `e6a32d65-c452-4e07-9393-4fd4c8e8fd6e` → `0x437432ec24f0f216bd5280d77664e1d7692a71c3` → 53846
- the-sentient-startup `0296cc76-6e88-4459-b978-aea036a893d7` → `0x580706c5813304c9f03367843ac4d47ca838e105` → 54476

**RRG seller payer wallets + erc8004 ids** (`scripts/place-seller-keys.mjs:23-36`; keys indexed by these addresses from `rrg/tmp/*.json`). Note unknown-union pays from its CONCIERGE/agent wallet `0xe9cedf...`, not its brand payout wallet:
- clooudie `0xca5c9c4da1787fea491ed6c94e86b04ec46be61d` 45691; nolo `0x27daa49fb93445cdb6e3f3a6be7cd6bae1f04e2d` 45690; tyo `0xf78cb04c28e1898638ee4322f4b7b91ee8c0db00` 47353; university-of-diversity `0xb8ca93c837cdcb09ab7e0d61a740fd95d25d7961` 47320; les-basics `0x8d566ed9a15f38439465405f654416f1276f25b3` 51037; gumball-3000 `0x154bbd968dece4957c7604c8188a8048888de3f9` 51174; philleywood `0x35df756e97efd1db987e192ccefbf1b210bf4179` 50992; pitchers-only `0x03e1fc8bf74e11a1fb75d7fc54c1b613fd627d9d` 54261; livvium `0x52b406dd49e8fe0cc147e73f1c16ee04530241f5` 55582; jennys `0xe206d575572e563a490f4f63e7f8c45b11f87dd6` 55583; frey-tailored `0x30b1e8cc377a75d9664c26415a820c4925afa595` 45686; unknown-union (agent) `0xe9cedf6453b61771505404b47671602eaa158881` 44897

**x402 door:** `lib/app/x402-gate.ts` (via-app), settled by the Coinbase CDP facilitator (gas-free), open to any payer. Fees go to the platform wallet. Unlock fee then per-item offer fee.

**Key files:** agent `scripts/seller-agent.mjs`; key placement `scripts/place-seller-keys.mjs`; derivation `lib/app/agent-wallet.ts`; Box runner/setup `scripts/box-seller-agent-run.ps1` / `box-seller-agent-setup.ps1`.

**Two Supabase projects:** via-app `gcxyoujubqclenrhhill`, RRG `sanvqnvvzdkjvfmxnxur` — `app_sellers` (VIA) and `rrg_brands` (RRG) are separate; the roster spans both.
