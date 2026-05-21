# Algolia Index Configuration

Dashboard-side settings for `shopify_shxhidproducts` (Configuration tab).
None of these are applied programmatically — calling `index.setSettings()`
from the app races the Shopify→Algolia connector's own sync and causes
config drift. Apply manually and snapshot the diff here on every change.

## 1. Searchable attributes (Configuration → Searchable attributes)

Order matters. Top entries dominate ranking.

1. `title`
2. `sku` (unordered)
3. `vendor` (unordered)
4. `product_type` (unordered)
5. `tags` (unordered)
6. `named_tags` (unordered)
7. `body_html_safe` (unordered) — last
8. `body_html` — **remove** if `body_html_safe` is present

Rationale: body_html matches are marketing prose noise. Demoting to last
ensures title/sku/vendor dominate. Drop the raw HTML variant once
sanitised text is available.

## 2. Custom ranking (Configuration → Ranking and Sorting → Custom Ranking)

Used only to break ties after textual relevance:

- `desc(inventory_available)`
- `desc(inventory_quantity)`
- `desc(availability)` — if the index exposes it
- `desc(created_at)`

**Remove** `desc(views_count)` if present — it prevents accurate but
new/less-popular products from outranking old high-traffic ones.

## 3. Facets (Configuration → Facets)

Declare these as **filterOnly** (no facet-counts UI is needed):

- `vendor`
- `product_type`
- `tags`
- `inventory_available`

`vendor` MUST be filterable for the in-code brand-routing layer
(`applyVendorRouting` in `app/services/algolia.server.js`) to work.

## 4. Typo tolerance (Configuration → Typo Tolerance)

- **Disable typo tolerance on attributes:** `sku`, `vendor`
- **Allow typos on numeric tokens:** `false` (catalog-wide)

Both settings are also passed per-request from `buildTypoPolicy()`, but
setting them at the index level is the defence-in-depth layer.

## 5. Synonyms (Configuration → Synonyms)

Audit and remove any synonym mapping NUMBERS to other numbers. Examples
to delete:

- ❌ `5mm = 50mm`
- ❌ `5 = 60`

These are catastrophic — they tell Algolia 5 mm products satisfy a
60 mm query.

One-way synonyms that map UNITS or WORDS are fine, e.g.:
- ✅ `mm → millimetre`
- ✅ `aodd → air-operated double diaphragm pump`

## 6. Connector follow-ups (out of scope for code)

If the Shopify→Algolia connector exposes per-metafield indexing on
your plan, add these as searchable attributes (move below `tags` in
priority):

- `meta.specifications.detection_range`
- `meta.specifications.sensing_range`
- `meta.specifications.ip_rating`
- `meta.specifications.mounting_type`
- `meta.specifications.output_type`

If the connector does not support this, the spec-aware re-ranker in
`scoreHitBySpec()` is the load-bearing fallback.
