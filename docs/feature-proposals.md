# Feature Proposals — ranked by value/effort for a B2B industrial buyer

Companion to `AUDIT.md` (2026-07-08). **Propose-only: nothing here is built.** Each item lists user story, touched files, dependencies, risk, and rough effort (S/M/L). Ranking assumes the P0/P1 remediation has landed (Algolia index guard, vendor routing, exact-SKU probe, Sonnet model).

Recommended first picks: **#1, #3, #5** — they attack the two reported symptoms directly (search usefulness on a 200k catalog; answer usefulness beyond "browse the cards").

---

## 1. Pagination / "View all N results" deep-link — HIGH value / S-M effort

**User story:** A procurement engineer asks for "ABB contactors", sees 10 cards, and needs the other 190 — today the conversation dead-ends at 10.

- **Design:** keep the 10-card UI cap; add (a) a "View all N results on creativeautomation.ae" link on the results header, deep-linking to the storefront collection/search URL with the vendor/type filter applied, and (b) a "Show more" chip that re-queries Algolia with `page: n+1`.
- **Touched:** `algolia.server.js` (accept `page`, return `nbHits`), `search-router.server.js` (thread through + include `totalCount` in `systemHint`), `chat.jsx` (new SSE field), `extensions/chat-bubble/assets/chat.js` (render link/chip).
- **Dependencies:** none server-side; storefront must have a search/collection URL scheme worth linking to.
- **Risk:** low. Pairs with audit finding B6.

## 2. Faceted refine in chat — HIGH value / M effort

**User story:** After "SMC solenoid valves" returns 10 of 400, the buyer taps "in stock only", "5/2 way", or a price band instead of typing a new sentence.

- **Design:** after a brand/category result, return 3-5 refine chips derived from Algolia facets (`product_type`, `inventory_available`, price ranges); a tap re-runs the search with `filters` appended.
- **Touched:** `algolia.server.js` (request `facets`, expose them), `search-router.server.js`, `chat.jsx` (SSE `refine_options` event), frontend chip rendering.
- **Dependencies:** dashboard facet declarations per `docs/algolia-config.md` §3 (verify `product_type`, `inventory_available` are facetable).
- **Risk:** medium (UI + state handling); server side is straightforward.

## 3. Exact-SKU quick-add to cart — HIGH value / S effort

**User story:** A repeat buyer pastes `BP06PP-PTT4-B`, confirms the single matched product, and adds it to cart in two taps — the core B2B reorder loop.

- **Design:** when the router resolves `sku_exact` with exactly one product, the card gets a prominent "Add to cart" affordance and the assistant offers quantity ("How many do you need?"); reuse the existing `/api/cart` endpoint and `update_cart` flow.
- **Touched:** `chat.jsx` (flag `exact_single: true` on the SSE payload), `extensions/chat-bubble/assets/chat.js` (quick-add UI); cart plumbing already exists (`api.cart.jsx`, `storefront-service.js#addToCart`).
- **Dependencies:** the B4 exact-SKU probe (landed).
- **Risk:** low — no new external calls.

## 4. Bulk-quote capture — MEDIUM-HIGH value / M effort

**User story:** "I need 250 units of this delivered to Jeddah by August" — today the prompt asks qty/country/date but the answers evaporate into chat history.

- **Design:** new `QuoteRequest` Prisma model (product ref, qty, country, target date, contact, conversationId); a structured "request quote" tool or a lightweight form triggered when the B2B prompt's bulk flow completes; notify `websales@` (email or webhook) and track a PostHog event.
- **Touched:** `prisma/schema.prisma` (+migration), `app/routes/leads.jsx` or a new `quotes.jsx`, prompt tweak in `claude.server.js`, frontend form.
- **Dependencies:** decision on notification channel (email service vs manual dashboard).
- **Risk:** medium — PII handling and migration; high business value (quotes are the actual revenue event for B2B).

## 5. "Datasheet / spec" answer mode — HIGH value / M effort (the real fix for A2)

**User story:** "Which of these is IP67 and has 60mm range?" gets an actual answer, not "browse the cards above."

- **Design:** two changes. (a) Feed Claude the data: include `description`/`product_type`/key spec fields for the displayed products in the `[SYSTEM NOTE]` summary (today only title/vendor/price/sku, `chat.jsx:328-333`, and MCP tool results are truncated to a 3-product stub, `chat.jsx:499-505`). (b) Relax the prompt: keep "no product lists" for search turns, but allow comparative/spec prose when the user asks a question about already-displayed products.
- **Touched:** `chat.jsx` (richer summaries), `claude.server.js` (prompt rules), token-budget check (10 products × 500-char descriptions ≈ acceptable).
- **Dependencies:** owner sign-off on the A2 behavior change; spec data quality in descriptions/metafields.
- **Risk:** medium — prompt changes need QA against the terse-cards behavior; mitigated by `CLAUDE_CHAT_MODEL` env rollback and prompt versioning.

## 6. Stock / lead-time answers — MEDIUM value / S effort

**User story:** "Is this in stock?" answered from data instead of escalation.

- **Design:** `inventory_available` / `inventory_quantity` are already retrieved from Algolia (`algolia.server.js` attributesToRetrieve); surface them on the card payload (`in_stock: true, qty: 14`) and in the pre-found summary so the model can answer; show a stock badge on cards.
- **Touched:** `algolia.server.js` (map fields onto the product object), `chat.jsx` summary, frontend badge.
- **Dependencies:** Algolia record freshness (connector sync cadence) — display as "usually in stock" if stale.
- **Risk:** low; wrong stock claims are the main hazard — hedge wording.

## 7. Search analytics dashboard — MEDIUM value / M effort

**User story:** The owner sees which queries return zero results (catalog gaps), which tier answers what share of traffic, and how often rerank changes the top result.

- **Design:** the `[SearchAudit]` lines now emit `outcome=hit|empty|error` per tier (audit C1). Ship them to PostHog as a `search_tier_result` event (posthog.server.js already exists) and build a PostHog dashboard: zero-result queries, tier mix, per-tier latency, rerank movement rate.
- **Touched:** `search-router.server.js` (+1 PostHog call next to `auditTier`), PostHog dashboard config.
- **Dependencies:** PostHog enabled in prod (verify events currently arrive — audit §7 observability note).
- **Risk:** low.

## 8. Multilingual verification — LOW-MEDIUM value / S effort

**User story:** An Arabic-speaking buyer writes "حساس تقارب 24 فولت" and gets the same results as "proximity sensor 24V".

- **Design:** the prompt already claims translate-to-English (`claude.server.js`), but the smartSearch pre-pass runs BEFORE Claude ever sees the message — QueryIntel receives the raw Arabic and its rewrite behavior is unverified. Add explicit translate-then-rewrite examples to the QueryIntel system prompt and a small eval set (Arabic/French/Spanish product queries) to the test suite via recorded rewrites.
- **Touched:** `query-intelligence.server.js` prompt, tests.
- **Dependencies:** representative non-English query samples from real traffic (PostHog).
- **Risk:** low.

---

### Explicitly deferred engineering items (from AUDIT.md, not user-facing features)

- Storefront token reuse/cleanup (X1) — prevents an eventual hard outage; S effort, do soon.
- CORS origin allow-list + message size cap + rate limiting (X2) — S effort, needs owner's origin list.
- Rerank consolidation into one module (B5) — M effort, refactor-only.
- DI refactor to enable a mocked integration test of the tier cascade (C3) — M effort.
- Conversation retention/TTL job — S effort.
