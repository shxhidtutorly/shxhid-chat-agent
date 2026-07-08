# Production Audit — shxhid-chat-agent

**Date:** 2026-07-08 · **Audited ref:** `main` @ `6489d94` · **Auditor:** automated code audit (static read + docs verification; no runtime access)

Scope: the two reported symptoms — *"the bot gives vague answers"* and *"searching 200k+ products by SKU / brand / product name is unreliable"* — plus a production-readiness sweep. Every claim cites `file:line` in the audited ref. Items that need a live index, prod env vars, or real Shopify data are listed in §5 with the exact check to run.

---

## 1. Executive summary — top 5 issues by user impact

| # | Issue | One-line fix | Effort |
|---|-------|--------------|--------|
| 1 | **B1 — Algolia silently disabled/misrouted if `ALGOLIA_INDEX_NAME` is unset.** Code defaults to index `shopify_products` (`app/services/algolia.server.js:456`) but the real index is `shopify_shxhidproducts` (`docs/algolia-config.md:3`), and `isAlgoliaConfigured()` never checks the index name (`algolia.server.js:87-89`). If the env var is missing in prod, Tier 1 quietly returns nothing and every search runs on the much weaker Admin/Storefront fallbacks — which presents exactly as "bad search". | Require `ALGOLIA_INDEX_NAME` in `isAlgoliaConfigured()`, remove the silent default, fail loudly, add a health check. | S |
| 2 | **A1 — Main chat runs Haiku while its own comment mandates Sonnet.** `claude.server.js:40-53`: the block comment says "Sonnet (not Haiku) is intentional… do NOT downgrade without re-running the search QA suite", but `apiParams.model` is `"claude-haiku-4-5-20251001"`. The multi-step tool-use orchestration is exactly where a small model gives thin, tool-mistake-prone answers. | Make the model env-configurable; restore the documented Sonnet default; A/B on the QA suite. | S (+eval M) |
| 3 | **B2 — Brand routing capped at 100 vendors.** `getVendorSet` uses `searchForFacetValues` with `maxFacetHits: 100` (`algolia.server.js:116`) — Algolia's hard maximum for that API. Any brand beyond the first 100 facet hits never gets a `vendor:` filter and falls into noisy free-text. | Fetch the full vendor list via Admin GraphQL `productVendors` (paginated, 1000/page) when the facet cap is hit or the facet call fails. | S |
| 4 | **B3 — Tier-2 Admin search uses unsupported leading wildcards.** `adminTextSearch` builds `title:*token*` clauses (`admin-products.server.js:182,188`). Shopify's search syntax supports **prefix wildcards only** (`norm*`) — verified against shopify.dev/docs/api/usage/search-syntax on 2026-07-08. Leading `*` is undefined behavior; recall on the fallback tier is unreliable at 200k. | Use `token*` prefix form and widen pass 2 across `vendor`/`product_type`/`sku`. | S |
| 5 | **A2/A3 — The prompt mandates vagueness, and there are two divergent prompt sources.** The live hardcoded prompt forces "Maximum 2-3 sentences… DO NOT list product names, SKUs, or specifications" (`claude.server.js:126-136`), while `app/prompts/prompts.json` is a dead, divergent copy (zero imports anywhere). Prompt "fixes" applied to the JSON silently no-op. | Delete the dead copy; then decide terse-plus-cards vs. spec-answering with the owner (product decision — see §6). | S (+owner decision) |

---

## 2. Findings table

Status legend: **CONFIRMED** (reproduced in code), **ALREADY-FIXED** (claimed issue no longer present on `main`), **NOT-REPRODUCED** (claim doesn't hold as stated), **PARTIAL** (holds with caveats). "Cannot confirm without runtime" items are additionally listed in §5.

| ID | Area | Sev | Status | Evidence | Fix | Risk of fix |
|----|------|-----|--------|----------|-----|-------------|
| A1 | Model choice | P0 | **CONFIRMED** | `app/services/claude.server.js:40-53` — comment mandates Sonnet ("do NOT downgrade without re-running the search QA suite"), live model is `claude-haiku-4-5-20251001`. v4.1 header (`:5-9`) shows the string was "corrected" from the invalid `claude-haiku-4-5`, i.e. the Haiku downgrade itself was never a documented decision. README's architecture diagram also says "(Haiku 4.5)" — the two internal docs contradict each other. Both model IDs verified valid against current Anthropic docs; `claude-sonnet-4-6` is a current, active model. | Env-configurable model (`CLAUDE_CHAT_MODEL`), default restored to `claude-sonnet-4-6` per the in-file QA-backed decision. Rollback = set env var to the Haiku ID, no deploy needed. Whether Haiku is *sufficient* needs the QA eval (§5.1). | Low (env rollback); cost/latency increases vs Haiku |
| A2 | Prompt design | P1 | **CONFIRMED** | `claude.server.js:126-136` — "Maximum 2-3 sentences", "DO NOT list product names, SKUs, or specifications", "respond with ONLY 1-2 short lines", example "I found 8 tag fuses… Browse the cards above." Same rules in the B2B prompt (`:244`). Also every pre-found-products path instructs "Write ONE short conversational reply (1-2 sentences)" (`app/routes/chat.jsx:338`). | Deliberate design (cards render in UI) — but it is *the* direct cause of "vague answers" for spec/comparison questions. Product decision required; see proposal "Datasheet/spec answer mode" in `docs/feature-proposals.md`. Not changed in this remediation. | — |
| A3 | Prompt sources | P0 | **CONFIRMED** | `app/prompts/prompts.json` (v5.1/v4.1, dated 2026-04-20) is imported **nowhere** (repo-wide grep: only hits are the file itself and a README mention). The hardcoded `getSystemPrompt` in `claude.server.js:117-273` is what runs. The two diverge materially (JSON has a "STRICT LINK POLICY" section absent from the live prompt; live prompt has the SEARCH DECISION TREE absent from JSON). Also `app/services/config.server.js` is a third dead config (zero imports; stale model `claude-sonnet-4-20250514`, `maxProductsToDisplay: 12` vs the real 10). | Deleted `app/prompts/prompts.json`. `config.server.js` left in place but flagged as dead — remove in a follow-up or wire it up. | None (dead code) |
| A4 | promptType default | P2 | **CONFIRMED** | `chat.jsx:144` defaults `prompt_type` to `"standardAssistant"`; `getSystemPrompt` defines only `creativeAutomationAssistant`/`creativeAutomationB2B` and works only via the `\|\| prompts.creativeAutomationAssistant` fallback (`claude.server.js:272`). | Default changed to `creativeAutomationAssistant`; `getSystemPrompt` now warns on unknown types. | None |
| B1 | Algolia config | P0 | **CONFIRMED** (env value itself: cannot confirm without prod access) | Default `'shopify_products'` at `algolia.server.js:456`; `isAlgoliaConfigured()` checks only APP_ID + SEARCH_KEY (`:87-89`); real index `shopify_shxhidproducts` per `docs/algolia-config.md:3`. A wrong index yields the "Index not found" branch (`:531-541`) which returns `null` — indistinguishable from "no results" to the router, which then logs a *skip* only when unconfigured (`search-router.server.js:407`), not when misrouted. | `isAlgoliaConfigured()` now requires `ALGOLIA_INDEX_NAME`; silent default removed; loud startup error when partially configured; health check added to `/api/diag?health=1`. | Low — if prod relied on the literal default index name `shopify_products`, set `ALGOLIA_INDEX_NAME=shopify_products` (rollback note) |
| B2 | Vendor routing | P0 | **CONFIRMED** (vendor count >100: cannot confirm without live index) | `algolia.server.js:113-117` — `searchForFacetValues` with `maxFacetHits: 100`, which is also Algolia's hard API maximum, so "raise the cap" is impossible via this API. On facet failure, routing silently disables for 5 min (`:132-137`). Additionally `docs/algolia-config.md:39-47` prescribes `vendor` as **filterOnly** — a filterOnly facet is *not searchable* by `searchForFacetValues`, so if the dashboard matches its own doc, the facet call likely returns nothing and vendor routing is *fully* dead, not just capped (dashboard state: cannot confirm without access; check in §5.3). | Vendor set now falls back to / merges with Admin GraphQL `productVendors` (verified paginated, 1000/page, `read_products` scope) whenever the facet call fails, returns empty, or returns exactly the 100 cap. | Low — adds one cached (24h) Admin call |
| B3 | Admin Tier-2 recall | P1 | **CONFIRMED** | `admin-products.server.js:182` `title:*${t}*` AND-clauses; `:177-178,188` same leading-wildcard shape. Shopify search-syntax docs (fetched 2026-07-08): `*` is supported for **prefix** matching only (`query=norm*`); no leading/infix wildcard support documented. Primary pass also searches `title` only. | Pass 1 → `title:${t}*` AND-clauses; pass 2 → first-token prefix across default fields + `vendor`/`product_type`/`sku`. | Low — fallback tier only (runs when Algolia empty/down) |
| B4 | SKU detection | P0 | **CONFIRMED** (as designed-in risk) | `search-router.server.js:122-197` — regex-stack `detectSku`/`matchSkuToken` **gates** the exact Admin `sku:` lookup: a real SKU the regexes miss (e.g. 4-char codes like `E125`, tokens whose shape collides with the measurement blacklist) never reaches `productVariants(query:"sku:…")` and falls into text search. The self-test (`:200-234`) protects known shapes only. | Added an always-on exact-SKU probe: raw letter+digit tokens (≥4 chars, measurement/IP/Cat blacklist retained) are probed against Admin `sku:` **exact match only**, before the text tiers, independent of regex classification. Regex path unchanged and still runs first (prioritization, not gatekeeping). | Low — probe fires only on SKU-ish tokens; exact-match-only so no noise |
| B5 | Rerank layers | P2 | **PARTIAL — NOT-REPRODUCED as "competing"** | Three scorers exist: spec+business rerank in `algolia.server.js:333-401,550-593`; `scoreProductBySpecs`+`scoreProductByRelevance` in `tool.server.js:107-153,313-323`; the router itself does **not** rerank. But they operate on **disjoint paths**: the Algolia rerank applies to Tier-1 pre-pass results; the tool.server rerank applies only to MCP `search_catalog` results (`chat.jsx:491`), which the pre-pass usually pre-empts (tools stripped on high-confidence, `chat.jsx:360-382`). They never reorder the same result set. Real issue is duplication/no shared contract, not contradiction. | Document the ranking contract (below, §4). Consolidation is safe to defer; no change made. | — |
| B6 | 10-result cap | P2 | **CONFIRMED (intentional)** | `tool.server.js:248` `MAX_PRODUCTS_TO_DISPLAY = 10` (v5.1 changelog: reduced from 12 deliberately); Algolia `first = 10` (`algolia.server.js:443`); all router tiers `first: 10`; Storefront default 10 (`storefront-service.js:168`). No pagination anywhere. | Intentional UI cap. Pagination/"view all N" is a feature, not a bug fix — proposed in `docs/feature-proposals.md` (#1). | — |
| B7 | Variant fan-out | P2 | **CONFIRMED, mitigated** | `algolia.server.js:200-240` — one `productByHandle` query per hit, up to 10 parallel. Mitigations already on `main`: hits carrying a variant id skip the lookup (`:622-628`), and the token-mint race is deduped (`shopify-storefront.js:25-27,51-66`). Latency impact: cannot confirm without runtime (§5.4). Real fix is syncing variant IDs into the Algolia record (dashboard/connector side). | No code change; dashboard checklist item added (§7). | — |
| C1 | Silent failures | P1 | **CONFIRMED** | `algoliaSearch` returned `null` for **both** errors (`:543-545`) and zero hits (`:595-600`) — the router cannot tell them apart; `adminTextSearch` same (`admin-products.server.js:191,222-225`); `searchWithStorefront` same (`storefront-service.js:182-185,191`); `searchBySku` returns `null` on error (`admin-products.server.js:122-125`) which `handleSkuSearch` treats as "no match". Only Algolia had `[SearchAudit]` lines. | `algoliaSearch` now returns `{products: [], error}` on failure vs `{products: []}` on empty; router logs `[SearchAudit] … outcome=hit\|empty\|error` per tier with latency. | Low — return shape change verified against the only caller (search-router) |
| C2 | Hardcoded tenant | P3 | **CONFIRMED** | `creativeautomation.ae` hardcoded in `search-router.server.js:20`, `algolia.server.js:630`, `claude.server.js` (prompt, `:201`), `chat.jsx:510`. Fine single-tenant; blocks multi-store. | Flagged only. If multi-store ever matters, derive from `shopDomain`/shop settings. | — |
| C3 | Test coverage | P2 | **CONFIRMED** | `tests/search.test.js` is the only test file (SKU detector + routing smoke via log capture). No tests for tier fallback, vendor routing, rerank, prompt selection, orchestration loop. | Added tests for config guard, SKU-probe token extraction, prompt selection, admin query builder; added CI. Integration test with mocked tiers proposed (needs DI refactor — deferred, see §6). | — |
| X1 | *(new)* Storefront token leak | P2 | **CONFIRMED (code-level)** | `shopify-storefront.js:81-147` — every cold boot mints a **new** storefront access token via Admin REST and never deletes old ones. Shopify caps storefront access tokens per shop (historically 100); after enough deploys, token creation starts failing and Storefront tier + variant lookups die. | Not changed (needs a deliberate strategy: reuse-by-title via GET before POST, or delete-oldest). Listed as open item §5.6. | — |
| X2 | *(new)* CORS + no input limits | P2 | **CONFIRMED** | `chat.jsx:624-635,637-650` and `leads.jsx:192-202` reflect **any** `Origin` and set `Access-Control-Allow-Credentials: true`; no message-size limit on `body.message`; no rate limiting on `/chat` (each request fans out to Anthropic + Shopify + Algolia). | Flagged; needs owner decision on allowed-origin list (app proxy vs direct). Message size cap is a small safe follow-up. | — |
| X3 | *(new)* No fetch timeouts | P2 | **CONFIRMED** | `shopify-storefront.js:101,180,228` — bare `fetch` with no timeout on Admin/Storefront calls (MCP + customer-account fetches do have timeouts: `chat.jsx:237-240,250-257,599-603`; QueryIntel/Anthropic rely on SDK defaults). A hung Shopify call stalls the SSE stream until platform timeout. | Added 15s `AbortController` timeouts to the three fetch sites. | Low |

---

## 3. Root-cause analysis of the two symptoms

### 3.1 "The bot gives vague answers"

Trace for a representative failing query — user asks *"which one is cheapest?"* after a result set is shown:

1. `chat.jsx:294-303` — no SKU tokens → no annotation.
2. `smartSearch` (`search-router.server.js:456-477`): the message matches the clarification regex (`/^(…|which one)\b/i`, `:251`) → `isConversationalMessage` returns `true` → `smartSearch` returns `null`. Same for anything matching the follow-up regex (`:246`, "any other", "what about…"). By design, on these follow-ups **no search runs and no new data is fetched**.
3. Claude is then asked to answer from conversation history where product data was *deliberately truncated*: tool results were replaced by a 3-product stub (`chat.jsx:499-505`) and the pre-pass summary carries only `title/vendor/price/sku` for 6 products (`chat.jsx:328-333`). Descriptions/specs are not in context.
4. The system prompt then caps the reply at 2-3 sentences and **forbids** listing names/SKUs/specs (`claude.server.js:126-136`).

So "vague" is overdetermined: (a) the prompt mandates it (A2), (b) the model often literally lacks the spec data to answer (the stop-hint stub), and (c) the weakest-tier model (A1 — Haiku) is doing the multi-step reasoning. A1 is the cheapest lever; A2 + the "spec answer mode" proposal is the real product fix.

### 3.2 "200k search by SKU / brand / product name is unreliable"

Trace for a brand query — *"show me Baumer sensors"* (assume Baumer is vendor #140 alphabetically-by-facet-count):

1. Pre-pass → `handleTextSearch` (`search-router.server.js:366`); QueryIntel rewrites to `"Baumer sensor"`.
2. Tier 1 `algoliaSearch`:
   - **If `ALGOLIA_INDEX_NAME` is unset in prod (B1):** index defaults to `shopify_products` → 404 branch (`algolia.server.js:531-541`) → `null`. Falls to Tier 2.
   - **If configured:** `applyVendorRouting` consults the vendor cache. With >100 vendors (B2) — or with `vendor` configured filterOnly so `searchForFacetValues` fails outright — "baumer" isn't in the set → no `vendor:` filter → free-text "Baumer sensor" against 200k records, where typo-tolerance and prose matches inject noise.
3. Tier 2 `adminTextSearch` (B3): query `title:*baumer* AND title:*sensor*` — leading wildcards aren't in Shopify's supported syntax → likely 0 rows → pass 2 `title:*baumer* OR vendor:*baumer*` — same problem.
4. Tier 3 Storefront `search` with `first: 10`, rejected entirely if `totalCount > 1000` (`search-router.server.js:438-441`) — a big brand can legitimately have >1000 matches → **null**, i.e. the guard designed to stop noise also kills valid broad brand queries.
5. Net result: zero or noisy results → Claude (with catalog tools available, since nothing was pre-found) retries via MCP `search_catalog`, whose brand recall problem is the documented reason the pre-pass exists (`chat.jsx:306-314`).

For SKU queries the analogous failure is B4: the regex gate misses a legitimate code → it's treated as text → tiers 1–3 all mangle it (QueryIntel may "fix the typo", Algolia typo-tolerance may drift it, Admin leading-wildcard fails) → "nothing found" for a SKU that an exact `sku:` lookup would have hit.

Every step above is individually plausible; B1 is the one that degrades **all** text searches at once, which is why it's ranked #1.

### 3.3 Ranking contract (B5 documentation)

Current effective ordering, per path:

- **Pre-pass Tier 1 (Algolia)** — Algolia textual relevance → re-scored by `spec` (`+1000` exact numeric/unit match, `−800` conflicting value, `algolia.server.js:350-401`) + `business` (`+200` in stock, `+50` qty>0, `−300` accessory, `:333-348`); Algolia order is the tiebreak (`:560-563`).
- **Pre-pass Tiers 2/3 (Admin/Storefront)** — provider order, no rerank.
- **MCP path (only when pre-pass found nothing / low-confidence)** — provider order → `scoreProductBySpecs` (SKU-pattern match `+1000/800/600/400`) + `scoreProductByRelevance` (title match, availability, image) in `tool.server.js:313-323`.

These never compose; the duplication is a maintenance hazard, not a correctness bug.

---

## 4. What's already good (don't tear out)

- **The tiered fallback itself** (`search-router.server.js:356-454`) — explicit, auditable, well-commented, with a sensible >1000-results noise guard (even if that guard needs a brand-query exception, §6).
- **Spec-token rerank** (`algolia.server.js:263-401`) — the `+1000/−800` exact-value scoring genuinely fixes the "asked 60mm, got 5mm" class of bugs, and handles spaced/unspaced unit forms.
- **Typo policy** (`buildTypoPolicy`, `algolia.server.js:414-441`) — SKU/vendor protected from typo matching, numerics locked; the scalar-vs-object regression is documented and tested by history (commit `6489d94`).
- **Result cache with LRU+TTL, empty results uncached** (`algolia.server.js:28-56`) and the **vendor cache with in-flight dedupe** (`:100-143`).
- **SKU detector self-test on import** (`search-router.server.js:200-234`) plus a real regression suite (`tests/search.test.js`) — kept and extended, not replaced.
- **Storefront token minting with in-flight dedupe + 401-retry** (`shopify-storefront.js:51-66,239-248`) — solves a real race (10 parallel variant lookups).
- **`[SearchAudit]` structured log line** (`algolia.server.js:497,597,704`) — the right pattern; now extended to all tiers.
- **MCP/customer-URL fetches already have timeouts and races** (`chat.jsx:237-257,599-603`), and `MAX_TOOL_LOOPS = 6` bounds the tool loop (`chat.jsx:219,389`).

---

## 5. Open questions / cannot confirm without runtime

1. **A1 model quality delta.** Needs the "search QA suite" the comment references (not in repo). Check: run ~30 representative queries (SKU, brand, spec, follow-up) against both `CLAUDE_CHAT_MODEL=claude-haiku-4-5-20251001` and `claude-sonnet-4-6`; compare tool-call correctness and answer usefulness. Until then the Sonnet default follows the in-file documented decision.
2. **B1 deployed env.** Check in Railway: `ALGOLIA_INDEX_NAME` present and equal to `shopify_shxhidproducts`? Then hit `GET /api/diag?token=…&health=1` (new) — it reports the resolved index name and live reachability.
3. **B2 actual vendor count + dashboard facet config.** Check: Algolia dashboard → Configuration → Facets: is `vendor` declared, and as `filterOnly` or `searchable`? Run the new health check — it reports `vendorSource` (`algolia_facet` vs `admin_product_vendors`) and the count. If the count is ≥100 via facets, the Admin merge is load-bearing.
4. **B7 latency.** Check: with `DEBUG_SEARCH=1`, compare `[SearchAudit] latency_ms` on queries whose hits carry `variants[]` vs not.
5. **Algolia synonyms sanity** (`docs/algolia-config.md:57-66`): dashboard-only; verify no number→number synonyms exist.
6. **X1 storefront token accumulation.** Check: Admin API `GET /admin/api/2025-01/storefront_access_tokens.json` — count tokens titled "Chat Agent Storefront Token". If near the cap, delete extras and add reuse logic.
7. **MCP `search_catalog` behavior** (schema drift v2.1–v2.3 history in `chat.jsx:1-22`): needs a live storefront MCP session to confirm the current schema; the code defensively supports both.

---

## 6. Deferred / owner decisions

- **A2 prompt behavior** — keep terse-plus-cards vs. allow spec/comparison prose. Paired with proposal #5 ("Datasheet/spec answer mode") in `docs/feature-proposals.md`.
- **Tier-3 `totalCount > 1000` rejection** (`search-router.server.js:438`) — correct for noise, wrong for big brands. Revisit after B2 lands (brand queries should resolve at Tier 1 with a vendor filter).
- **B5 consolidation** into one ranking module — safe to defer; contract documented in §3.3.
- **B6 pagination** — proposal #1.
- **`config.server.js`** dead config — delete or wire up.
- **X2 CORS/limits** — needs the owner to enumerate legitimate origins (theme extension goes through the Shopify app proxy; direct-origin calls may exist in dev).
- **Integration test of tier fallback** — requires injecting the Algolia/Admin/Storefront clients (currently module-level singletons + dynamic imports). Worth a small DI refactor in its own PR.

---

## 7. Production-readiness checklist

| Item | Status |
|------|--------|
| Secrets/config validated at boot | **Partial → improved.** Was: `ANTHROPIC_API_KEY` checked per-request (`chat.jsx:226`), `SHOPIFY_STORE_DOMAIN` logged at startup (`shopify-storefront.js:30-34`), Algolia unchecked (B1). Now: Algolia partial-config startup error + full check in `isAlgoliaConfigured()`. `.env.example` added. No single fail-fast boot validator yet (follow-up). |
| Health/readiness endpoint | **Added.** `GET /api/diag?token=<DIAG_TOKEN>&health=1` reports env presence (Anthropic/Algolia/Shopify/DB), resolved Algolia index + live reachability + vendor-source, and a DB ping. (MCP connectivity is per-shop/per-conversation; not probed here.) |
| Reliability: timeouts/retries | **Partial → improved.** MCP connect/customer-URL fetches already time-boxed (`chat.jsx:237-257`); Anthropic SDK has default timeout+2 retries; Admin/Storefront fetches now have 15s timeouts (X3). Storefront 401 retried once (`shopify-storefront.js:239-248`). `MAX_TOOL_LOOPS=6` enforced (`chat.jsx:389`); loop cannot run away (also bounded by `stop_reason`). SSE errors degrade gracefully (`chat.jsx:577-589`, `streaming.server.js:52-74`). No bounded retry on Algolia (client default) — acceptable. |
| Observability | **Partial → improved.** `[SearchAudit]` now on every tier with `outcome=hit\|empty\|error`. PostHog calls wrapped in try/catch (fire-and-forget; delivery unverified — needs prod PostHog access to confirm events arrive). No per-tier metrics dashboard (feature proposal #7). |
| Security | **Needs owner attention (X2).** CORS reflects any origin with credentials; no input size cap; no rate limit. `api.diag.jsx` correctly token-gated. No secrets in client bundle found (theme extension uses proxy URLs). PII: `leads.jsx` stores lowercased email + page + consent flag; conversations stored indefinitely (retention policy needed — see below). |
| Data/DB | **OK with a caveat.** `prisma migrate deploy` runs in `start` (`package.json:11`) and in Docker CMD/nixpacks. Conversation/message growth unbounded — no retention/TTL job; `Message.content` stores full JSON tool payloads. Flagged for follow-up. |
| Build/deploy | **OK.** Dockerfile (node:20-alpine + openssl for Prisma) is the Railway builder (`railway.json`); `nixpacks.toml` is a redundant alternate path (harmless, but two build definitions can drift — consider deleting one). `engines.node >=20` (`package.json:5`). Healthcheck path `/` returns the app index. |
| CI | **Added.** `.github/workflows/ci.yml`: `npm ci` + `npm run lint` + `node --test tests/` on PR/push. |
