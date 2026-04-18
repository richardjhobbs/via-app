# Agent-Readiness Playbook — getvia.xyz

A step-by-step manual for taking `getvia.xyz` from whatever it scores today on
[isitagentready.com](https://isitagentready.com) all the way to **Level 5
"Agent-Native"** with 100% passing checks. Based on the playbook that did the
same for `realrealgenuine.com` in one session on 2026-04-18.

> **Context:** VIA Labs (getvia.xyz) is the company. RRG (realrealgenuine.com)
> is the product. They are separate ERC-8004 agents with separate wallets.
> Do **not** cross-reference or mix their agent.json / MCP endpoints. See
> `CLAUDE.md` "Entity Hierarchy" section.

## 0. Before you start — read these

- `C:\Users\Richard\.claude\CLAUDE.md` — global user instructions
- `CLAUDE.md` in the getvia.xyz repo (if it has one)
- Memory files in `C:\Users\Richard\.claude\projects\*\memory\` for:
  - VIA entity structure
  - VPS deploy workflow (if applicable)
  - No-em-dashes rule, skip-preview-meta-commentary, diff-first-debugging
- This file

## 1. Baseline scan

Before touching anything, capture the current state:

```bash
curl -sk -X POST "https://isitagentready.com/api/scan" \
  -H "Content-Type: application/json" \
  -H "User-Agent: Mozilla/5.0" \
  -d '{"url":"getvia.xyz"}' -o "$TEMP/getvia-scan-before.json"
```

Then parse with node to see level / passes / fails:

```bash
node -e "
const d = JSON.parse(require('fs').readFileSync(process.env.TEMP + '/getvia-scan-before.json','utf8'));
console.log('LEVEL:', d.level, d.levelName, '| isCommerce:', d.isCommerce);
for (const [cat, checks] of Object.entries(d.checks||{})) {
  console.log('['+cat+']');
  for (const [name, c] of Object.entries(checks)) {
    console.log(' ', c.status.padEnd(7), name, '-', c.message||'');
  }
}
"
```

## 2. Architecture discovery

Figure out how getvia.xyz is hosted **before writing any code**:

- Is there an existing repo? (`C:\Users\Richard\Documents\via-*\` ?)
- Hosted on Vercel? Hetzner VPS? Worker?
- Framework: Next.js app router? Plain HTML? Astro? Something else?
- Is there an `agent.json` already? If yes, note its content.
- Does it have `/mcp`? If so — where is the MCP server code?

Record VIA Labs' ERC-8004 identity for agent-card.json:

- Agent ID: **38538**
- Wallet: **VIA Team Wallet** (see memory `via_labs_structure.md` for exact
  address — confirm with `curl https://getvia.xyz/agent.json`)
- Profile: `https://8004scan.io/agents/base/38538`

## 3. The 14 checks Cloudflare's scanner runs

For each, the remediation path for a typical Next.js app:

| Category | Check | Artifact | Expected result |
|---|---|---|---|
| Discoverability | `robotsTxt` | `/robots.txt` | 200 text/plain, per-agent AI rules |
| Discoverability | `sitemap` | `/sitemap.xml` | 200 application/xml, valid structure |
| Discoverability | `linkHeaders` | Response headers | At least one `describedby` / `api-catalog` / `service-doc` / `sitemap` Link |
| Content Accessibility | `markdownNegotiation` | Middleware | When `Accept: text/markdown`, return `text/markdown; charset=utf-8` |
| Bot Access Control | `robotsTxtAiRules` | `/robots.txt` | GPTBot / ClaudeBot / PerplexityBot / Google-Extended / CCBot rules |
| Bot Access Control | `contentSignals` | `/robots.txt` | `Content-Signal: search=yes, ai-train=yes, ai-input=yes` |
| Bot Access Control | `webBotAuth` | `/.well-known/http-message-signatures-directory` | JWKS (can skip — informational only) |
| Discovery | `apiCatalog` | `/.well-known/api-catalog` | 200 application/linkset+json, RFC 9727 linkset |
| Discovery | `oauthDiscovery` | `/.well-known/openid-configuration` or `/.well-known/oauth-authorization-server` | 200 with issuer/endpoints/grants |
| Discovery | `oauthProtectedResource` | `/.well-known/oauth-protected-resource` | 200 with resource + authorization_servers |
| Discovery | `mcpServerCard` | `/.well-known/mcp/server-card.json` | 200 JSON with transport + capabilities (SEP-1649) |
| Discovery | `a2aAgentCard` | `/.well-known/agent-card.json` | 200 with `name`, `version`, `description`, `supportedInterfaces`, `skills` |
| Discovery | `agentSkills` | `/.well-known/agent-skills/index.json` | v0.2.0 schema with SHA-256 digests |
| Discovery | `webMcp` | Client JS | `navigator.modelContext.registerTool()` called on page load |
| Commerce | `x402` | `/api` or `/api/v1` | Returns 402 with x402 v2 payload + `PAYMENT-REQUIRED` header (base64 JSON) |
| Commerce | `ucp` | `/.well-known/ucp` | 200 JSON with top-level `ucp` object |
| Commerce | `acp` | `/.well-known/acp.json` | **Services must be string enum: `["checkout","orders","delegate_payment"]`** — NOT objects |
| Commerce | `ap2` | Via `agent-card.json` extensions | Extension entry with `name: "ap2"` and URI containing `ap2` |

**getvia.xyz caveat:** If VIA Labs is not a commerce site, the 4 Commerce
checks will be **neutral (not a commerce site)** — still counts as Level 5
as long as nothing is FAILING.

## 4. File templates

**Reference implementation lives in the RRG repo.** Copy these files as
starting templates, then retarget strings (wallet, agent id, domain, name,
descriptions):

| Source (RRG repo) | What to change |
|---|---|
| `app/robots.txt/route.ts` | Sitemap URL + Host |
| `app/sitemap.ts` | `BASE`, table names in DB queries |
| `app/.well-known/api-catalog/route.ts` | anchor URL + service-desc / service-doc hrefs |
| `app/.well-known/agent-card.json/route.ts` | name, description, wallet, skills, commerce section |
| `app/.well-known/mcp/server-card.json/route.ts` | name, description, tools array, agentId |
| `app/.well-known/agent-skills/_skills.ts` | Skill markdown content |
| `app/.well-known/agent-skills/index.json/route.ts` | Keep as is (imports _skills.ts) |
| `app/.well-known/agent-skills/*/SKILL.md/route.ts` | One per skill |
| `app/.well-known/ucp/route.ts` | services + payment section |
| `app/.well-known/acp.json/route.ts` | **Keep services as the string enum** |
| `app/.well-known/x402/route.ts` | payTo wallet |
| `app/.well-known/openid-configuration/route.ts` | issuer host |
| `app/.well-known/oauth-authorization-server/route.ts` | issuer host |
| `app/.well-known/oauth-protected-resource/route.ts` | resource / authorization_servers |
| `app/agent.json/route.ts` | **Entire content — use VIA Labs identity, not RRG** |
| `app/api/route.ts` | payTo, recipient, resource URL, service description |
| `app/api/v1/route.ts` | Imports `./route` GET — no changes |
| `middleware.ts` | `MARKDOWN_PAGES` keys + content, matcher paths |
| `components/rrg/WebMCPTools.tsx` | Tool definitions matching VIA's site surface |
| `app/providers.tsx` | Import + render `<WebMCPTools />` inside existing provider tree |

## 5. Critical gotchas

**These burned time on the RRG pass. Do not repeat.**

1. **ACP `services` must be a string enum** from
   `["checkout", "orders", "delegate_payment"]`, NOT an array of service
   objects. The skill doc says "non-empty array" but the schema in
   [PR #137](https://github.com/agentic-commerce-protocol/agentic-commerce-protocol/pull/137)
   is strict enum.

2. **Don't use `@x402/next` with its default facilitator URL.** `facilitator.x402.org`
   does not resolve. Either:
   - Find a working public facilitator (see `https://www.x402.org/ecosystem?filter=facilitators`)
   - Or emit the 402 manually. Required format:
     - Status: `402`
     - Header: `PAYMENT-REQUIRED: <base64 of JSON.stringify({x402Version:2, error, resource, accepts:[...]})>`
     - Header: `x402-version: 2`
     - Body: JSON with hint text
   - Use the RRG `app/api/route.ts` as the template.

3. **Next.js `app/` supports dotfile folders.** `app/.well-known/...` and
   `app/agent.json/route.ts` both work. Don't use `public/` for these.

4. **`app/robots.ts` (MetadataRoute.Robots) does NOT support Content-Signal.**
   Use a raw route handler at `app/robots.txt/route.ts` instead.

5. **If the site redirects `/` to another path** (e.g. `/home`), the
   markdown middleware won't fire for `/` because the redirect happens
   before Next.js. Either remove the redirect or also configure middleware
   on the redirect target.

6. **A2A agent card needs `supportedInterfaces`**, not just `url` + transport.
   Shape:
   ```json
   "supportedInterfaces": [{"transport": "JSONRPC", "url": "https://getvia.xyz/mcp"}]
   ```

7. **AP2 detection is URI-pattern matching**, not name matching. Declare AP2
   in `extensions` with multiple URI variants so at least one matches what
   the scanner is looking for. See RRG `agent-card.json` extensions array.

8. **nginx config (VPS deploys only).** If VIA is on a VPS with nginx:
   - Add `Link` header at server level with `describedby` / `api-catalog` /
     `service-doc` / `sitemap` entries
   - Make sure `/`, `/robots.txt`, `/sitemap.xml`, `/.well-known/*`,
     `/agent.json`, `/api` all reach the Next.js app (no hardcoded redirects
     or static-file interception)

9. **Identity hygiene — do not cross-reference RRG from VIA or vice versa.**
   - getvia.xyz/agent.json → agentId 38538, VIA Team Wallet
   - getvia.xyz/.well-known/agent-card.json → VIA Labs, NOT RRG
   - MCP card → getvia.xyz/mcp (if VIA has one; if not, don't invent it)

10. **Commit per concern.** One commit per file / per check, so reverting a
    single bad artifact is a one-commit revert.

## 6. Recommended commit sequence

```
1. robots.txt (route handler with AI bot rules + Content-Signal)
2. sitemap.xml (Next.js MetadataRoute.Sitemap)
3. agent.json (Next.js route handler — VIA Labs identity)
4. .well-known/agent-card.json (A2A card with supportedInterfaces + AP2 extensions)
5. .well-known/mcp/server-card.json (MCP SEP-1649 card)
6. .well-known/api-catalog (RFC 9727 linkset)
7. .well-known/agent-skills/index.json + SKILL.md files (with SHA-256 digests)
8. .well-known/openid-configuration + oauth-authorization-server
9. .well-known/oauth-protected-resource
10. .well-known/ucp + .well-known/acp.json (correct string-enum services!)
11. .well-known/x402 discovery + /api + /api/v1 returning 402
12. middleware.ts (markdown negotiation)
13. WebMCPTools.tsx + providers wire-up
14. nginx config (Link header, serve paths) — if applicable
```

## 7. Rescan loop

After each commit+deploy cycle:

```bash
curl -sk -X POST "https://isitagentready.com/api/scan" \
  -H "Content-Type: application/json" -H "User-Agent: Mozilla/5.0" \
  -d '{"url":"getvia.xyz"}' -o "$TEMP/scan.json"
node -e "
const d = JSON.parse(require('fs').readFileSync(process.env.TEMP+'/scan.json','utf8'));
console.log('LEVEL:', d.level, d.levelName);
let p=0,f=0,n=0;
for (const c of Object.values(d.checks)) for (const x of Object.values(c))
  x.status==='pass'?p++:x.status==='fail'?f++:n++;
console.log(p, 'pass |', f, 'fail |', n, 'neutral');
"
```

If a check is still failing, drill into its `evidence` array — the scanner
records exactly what it fetched and what validation failed:

```bash
node -e "
const d = JSON.parse(require('fs').readFileSync(process.env.TEMP+'/scan.json','utf8'));
const check = d.checks.discovery.a2aAgentCard;  // or whichever
console.log(JSON.stringify(check.evidence, null, 2));
"
```

## 8. Success criteria

- Scanner returns `level: 5`, `levelName: "Agent-Native"`
- `nextLevel: undefined` (there is no higher level)
- Zero FAIL checks
- Remaining NEUTRALS are only:
  - `webBotAuth` (outbound bot signing — optional)
  - Commerce checks (if VIA isn't a commerce site — expected)

## 9. When you're done

- Update memory file index (`MEMORY.md`) with a new topic file:
  `getvia_agent_readiness.md` describing what you shipped
- Update the VIA Labs build log on Notion if applicable
- Verify Local = GitHub = VPS (if VPS deploy)
- Commit + push everything to master

---

**Reference commits in the RRG repo:**

- `64e2009..7456616` — round 1: robots, sitemap, a2a, mcp card, agent.json, nginx Link
- `42a7240` — round 2: content signals, api-catalog, agent-skills, UCP, ACP, markdown middleware
- `38e06dd` — round 3: OAuth + OIDC + Protected Resource, x402 at /api, AP2 extensions
- `60df62b` — round 4: x402-demo endpoint
- Final round — ACP string enum fix, WebMCP registerTool(), x402 v2 manual emit

Each commit is ~1 file, atomic, easy to cherry-pick if you want to replicate
one piece at a time for getvia.xyz.
