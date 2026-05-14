/**
 * Algolia Search Service — v3.1 (Production Fix)
 *
 * CHANGES (v3.1 — May 2026):
 *
 * FIX 1: "undefined" string image — some Algolia records have the literal
 *   string "undefined" (not null) as product_image. Added explicit check:
 *   `hit.product_image !== 'undefined'` to reject this invalid value.
 *
 * FIX 2: Result count — changed default `first` from 20 to 10. Sending 20
 *   product cards overwhelms the chat UI. 10 is sufficient for the user to
 *   browse and ask follow-up questions.
 *
 * CONFIRMED field shapes from Algolia dashboard (May 2026):
 *   product_image  → string URL (the image field) — may be "undefined" string for some records
 *   price          → integer in AED (e.g. 4437)
 *   sku            → string at top level
 *   id / objectID  → numeric Shopify product ID
 *   handle         → product handle string
 *   variants       → NOT present in index (product-level index)
 *
 * Since variant IDs are not in the Algolia index, we batch-fetch them
 * from the Storefront API after getting Algolia results.
 */

let _client = null;

async function getClient() {
  if (_client) return _client;

  const appId = process.env.ALGOLIA_APP_ID;
  const apiKey = process.env.ALGOLIA_SEARCH_KEY;

  if (!appId || !apiKey) {
    throw new Error('[Algolia] ALGOLIA_APP_ID and ALGOLIA_SEARCH_KEY must be set');
  }

  const mod = await import('algoliasearch');
  const algoliasearch = mod.algoliasearch || mod.default;

  if (typeof algoliasearch !== 'function') {
    throw new Error(
      `[Algolia] Cannot find constructor. Keys: [${Object.keys(mod).join(', ')}]. Run: npm install algoliasearch`
    );
  }

  _client = algoliasearch(appId, apiKey);
  console.log('[Algolia] Client initialized');
  return _client;
}

export function isAlgoliaConfigured() {
  return !!(process.env.ALGOLIA_APP_ID && process.env.ALGOLIA_SEARCH_KEY);
}

/**
 * Fetch first variant IDs for a list of product handles from Storefront API.
 * Returns a Map of handle → { variantId, variantSku }.
 *
 * Implementation note: the previous batched `products(query: handle:"x" OR handle:"y" ...)`
 * path returned zero results in production — Storefront `search` is full-text
 * and does not OR multiple handle predicates. We now fire one `productByHandle`
 * query per handle in parallel; one HTTP round-trip's worth of wall time, but
 * exact and complete.
 */
async function fetchVariantIdsByHandles(handles, shopDomain) {
  if (!handles || handles.length === 0) return new Map();
  const { shopifyStorefrontQuery } = await import('../shopify-storefront.js');
  const variantMap = new Map();

  const SINGLE_QUERY = `
    query GetVariantByHandle($handle: String!) {
      productByHandle(handle: $handle) {
        handle
        variants(first: 1) {
          edges { node { id sku availableForSale price { amount currencyCode } } }
        }
      }
    }
  `;

  await Promise.allSettled(
    handles.filter(Boolean).map(async (handle) => {
      try {
        const data = await shopifyStorefrontQuery({
          query: SINGLE_QUERY,
          variables: { handle },
          shopDomain,
        });
        const product = data?.productByHandle;
        const firstVariant = product?.variants?.edges?.[0]?.node;
        if (firstVariant) {
          variantMap.set(handle, {
            variantId: firstVariant.id,
            variantSku: firstVariant.sku || null,
          });
        }
      } catch (err) {
        console.warn(`[Algolia] variant lookup failed for "${handle}": ${err.message}`);
      }
    })
  );

  console.log(`[Algolia] variant IDs resolved: ${variantMap.size}/${handles.length}`);
  return variantMap;
}

/**
 * Helper: determine if a product_image field value is a valid URL.
 *
 * Some Algolia records store the literal string "undefined" instead of null
 * when the image was missing at sync time. We must reject this value.
 */
function isValidImageUrl(value) {
  if (!value) return false;
  if (typeof value !== 'string') return false;
  if (value === 'undefined' || value === 'null') return false; // literal strings
  return value.startsWith('http');
}

/**
 * Extract numeric+unit tokens from a query: "60mm", "60 mm", "24V",
 * "10A", "IP67", "M12". Returns [{ value: 60, unit: "mm", raw: "60mm" }]
 *
 * These are HIGH-SIGNAL tokens. A product whose title/description/SKU
 * matches the EXACT numeric value must rank above a product that
 * only matches the brand/type words.
 */
function extractSpecTokens(query) {
  if (!query || typeof query !== "string") return [];
  const tokens = [];
  // Numeric+unit: 60mm, 60 mm, 5mm, 24V, 24VDC, 100A, 1000Hz
  const re = /(\d+(?:\.\d+)?)\s*(mm|cm|m|inch|in|"|v|vdc|vac|a|w|kw|hz|khz|°c|c)\b/gi;
  let m;
  while ((m = re.exec(query)) !== null) {
    tokens.push({
      value: parseFloat(m[1]),
      unit: m[2].toLowerCase().replace("°c", "c"),
      raw: m[0].toLowerCase(),
    });
  }
  // IP ratings
  const ipRe = /\bIP(\d{2})\b/gi;
  while ((m = ipRe.exec(query)) !== null) {
    tokens.push({ value: parseInt(m[1]), unit: "ip", raw: `ip${m[1]}` });
  }
  // M-thread codes (M8, M12, M18, M30) — treat as a categorical match,
  // not a numeric range, since adjacent sizes (M8 vs M10) are different
  // products entirely, not "close enough".
  const mRe = /\bM(\d{1,2})\b/g;
  while ((m = mRe.exec(query)) !== null) {
    tokens.push({ value: parseInt(m[1]), unit: "m_thread", raw: `m${m[1]}` });
  }
  return tokens;
}

/**
 * Build all the textual surfaces of a product that we can match
 * spec tokens against (lowercased, no html). Used by the re-ranker
 * because metafields aren't in the Algolia hit but the values often
 * leak into title/description/tags.
 */
function flattenHitText(hit) {
  const parts = [
    hit.title,
    hit.handle,
    hit.product_type,
    hit.vendor,
    Array.isArray(hit.tags) ? hit.tags.join(" ") : hit.tags,
    Array.isArray(hit.named_tags) ? hit.named_tags.join(" ") : "",
    hit.body_html_safe || hit.body_html || "",
    hit.sku,
  ];
  return parts
    .filter(Boolean)
    .join(" ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .toLowerCase();
}

/**
 * Score a hit against the query's spec tokens. EXACT numeric
 * matches earn a large positive score. Wrong numeric values earn a
 * large NEGATIVE score (so a 5mm product never outranks a 60mm
 * product when the user asked for 60mm).
 *
 * The unit-aware regex matches BOTH "60mm" and "60 mm" forms in
 * the product text — critical because the catalog uses the spaced
 * form ("60 mm") and QueryIntel emits the unspaced form ("60mm").
 */
function scoreHitBySpec(hit, specTokens) {
  if (!specTokens.length) return 0;
  const text = flattenHitText(hit);
  let score = 0;

  for (const tok of specTokens) {
    // Build a regex that matches the value+unit with optional whitespace.
    // For unit "m_thread" the pattern is "m12" (no space).
    let pattern;
    if (tok.unit === "m_thread") {
      pattern = new RegExp(`\\bm${tok.value}\\b`, "i");
    } else if (tok.unit === "ip") {
      pattern = new RegExp(`\\bip${tok.value}\\b`, "i");
    } else {
      pattern = new RegExp(
        `\\b${tok.value}\\s*${tok.unit}\\b`,
        "i"
      );
    }

    if (pattern.test(text)) {
      // Exact spec match — huge positive signal.
      score += 1000;
    } else {
      // Check if a DIFFERENT numeric value with the same unit appears
      // in the text (e.g. user asked for 60mm, this product shows 5mm).
      // That's an active mismatch → heavy negative score so the wrong
      // size never ranks above the right size.
      let mismatchRe;
      if (tok.unit === "m_thread") {
        mismatchRe = /\bm(\d{1,2})\b/gi;
      } else if (tok.unit === "ip") {
        mismatchRe = /\bip(\d{2})\b/gi;
      } else {
        mismatchRe = new RegExp(
          `\\b(\\d+(?:\\.\\d+)?)\\s*${tok.unit}\\b`,
          "gi"
        );
      }
      let mm;
      let foundDifferent = false;
      while ((mm = mismatchRe.exec(text)) !== null) {
        if (parseFloat(mm[1]) !== tok.value) {
          foundDifferent = true;
          break;
        }
      }
      if (foundDifferent) score -= 800;
    }
  }
  return score;
}

export async function algoliaSearch(query, { first = 10, shopDomain } = {}) {
  if (!query || typeof query !== 'string') return null;
  const trimmed = query.trim();
  if (!trimmed) return null;

  // Detect if this looks like a SKU/part code — if so, search EXACTLY as-is
  const looksLikeSku = /^[A-Z0-9]{2,}[-\.][A-Z0-9][-A-Z0-9\.\/]{2,}$/i.test(trimmed) ||
    (/^[A-Z]{2,}\d{2,}/.test(trimmed) && trimmed.length >= 5 && trimmed.length <= 20);

  if (looksLikeSku) {
    console.log(`[Algolia] SKU query detected — searching exact: "${trimmed}"`);
  }

  const indexName = process.env.ALGOLIA_INDEX_NAME || 'shopify_products';
  console.log(`[Algolia] Searching: "${trimmed}" in "${indexName}"`);

  // Single audit line so the exact outgoing query + typo policy are greppable.
  const _specTokensForLog = extractSpecTokens(trimmed);
  console.log(
    `[Algolia] OUTGOING query="${trimmed}" first=${first} typoTolerance=${
      looksLikeSku ? "off (sku)" : _specTokensForLog.length > 0 ? "off (numeric)" : "on"
    }`
  );

  let client;
  try {
    client = await getClient();
  } catch (err) {
    console.error(`[Algolia] Client init failed: ${err.message}`);
    return null;
  }

  let hits = [];
  try {
    const response = await client.search({
      requests: [{
        indexName,
        query: trimmed,
        hitsPerPage: first,  // v3.1: was hardcoded 20, now uses param (default 10)
        attributesToRetrieve: [
          'objectID', 'id', 'title', 'handle', 'vendor',
          'product_type', 'tags', 'body_html', 'body_html_safe',
          'price', 'variants_min_price', 'variants_max_price', 'currency_code',
          'product_image', 'image', 'featured_image', 'images',
          'variants', 'sku', 'named_tags',
        ],
        ...(looksLikeSku
          ? { optionalWords: [], typoTolerance: false }
          : extractSpecTokens(trimmed).length > 0
            ? {
                // Disable numeric-token typo substitution so "60" can't be
                // typo-matched to "50"/"65"/etc.
                // https://www.algolia.com/doc/api-reference/api-parameters/typoTolerance/
                typoTolerance: {
                  allowTyposOnNumericTokens: false,
                  minWordSizefor1Typo: 5,
                  minWordSizefor2Typos: 9,
                },
              }
            : { typoTolerance: true }),
      }],
    });
    hits = response.results?.[0]?.hits || [];
  } catch (searchErr) {
    const msg = searchErr.message || '';
    if (
      msg.includes('does not exist') ||
      msg.includes('Index not found') ||
      searchErr.status === 404
    ) {
      console.warn(
        `[Algolia] Index "${indexName}" not found. ` +
        `Sync at dashboard.algolia.com → Data Sources → Integrations → Shopify`
      );
      return null;
    }
    console.error(`[Algolia] Search error: ${msg}`);
    return null;
  }

  // Post-Algolia spec-aware re-rank. EXACT numeric matches float; products
  // with a DIFFERENT numeric value of the same unit (60mm asked, 5mm seen)
  // are pushed down hard so the wrong-size product never ranks at position 1.
  const specTokens = extractSpecTokens(trimmed);
  if (hits.length > 0 && specTokens.length > 0) {
    console.log(
      `[Algolia] spec tokens detected: ${JSON.stringify(specTokens)}`
    );

    const scored = hits.map((h, idx) => ({
      hit: h,
      idx, // preserve Algolia tiebreak order
      score: scoreHitBySpec(h, specTokens),
    }));

    scored.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.idx - b.idx; // Algolia's order as tiebreak
    });

    hits = scored.map((s) => s.hit);

    console.log(`[Algolia] post-spec re-rank top 5:`);
    scored.slice(0, 5).forEach((s, i) => {
      console.log(
        `  ${i + 1}. score=${s.score} sku=${s.hit.sku} title="${(s.hit.title || "").slice(0, 80)}"`
      );
    });
  }

  if (hits.length === 0) {
    console.log(`[Algolia] 0 results for "${trimmed}"`);
    return null;
  }

  console.log(`[Algolia] ${hits.length} results for "${trimmed}"`);

  // Full ranked top-N log so future ranking bugs are diagnosable from logs alone.
  if (hits.length > 0) {
    console.log(`[AlgoliaDiag] full ranked list (${hits.length} hits) for query="${trimmed}":`);
    hits.forEach((h, i) => {
      const price = h.variants_min_price ?? h.price ?? "?";
      console.log(
        `  ${i + 1}. sku=${h.sku || "?"} price=${price} title="${(h.title || "").slice(0, 90)}"`
      );
    });
    // Keep first-hit detail diagnostics for image/variant debugging:
    const h = hits[0];
    console.log(`[AlgoliaDiag] hit[0] product_image="${(h.product_image || "").substring(0, 80)}"`);
    console.log(`[AlgoliaDiag] hit[0] objectID=${h.objectID} id=${h.id} has_variants=${Array.isArray(h.variants) ? h.variants.length : "none"}`);
  }

  const handles = hits.map((h) => h.handle).filter(Boolean);
  const variantMap = await fetchVariantIdsByHandles(handles, shopDomain);

  const STOREFRONT_HOST = 'www.creativeautomation.ae';

  const products = hits.map((hit) => {
    const rawId = hit.objectID || hit.id || '';
    const productId = String(rawId).startsWith('gid://')
      ? rawId
      : `gid://shopify/Product/${rawId}`;

    // IMAGE (v3.1 FIX): Reject literal string "undefined" or "null" in addition to
    // falsy values. Some Algolia records have product_image = "undefined" (string).
    const imageUrl =
      (isValidImageUrl(hit.product_image) ? hit.product_image : null) ||
      (hit.image && typeof hit.image === 'object' && isValidImageUrl(hit.image.src)
        ? hit.image.src : null) ||
      (isValidImageUrl(hit.image) ? hit.image : null) ||
      (isValidImageUrl(hit.featured_image) ? hit.featured_image : null) ||
      (Array.isArray(hit.images) && isValidImageUrl(hit.images[0]) ? hit.images[0] : null) ||
      null;

    // PRICE: integer in AED (e.g. 4437), NOT cents
    const rawPrice = hit.variants_min_price ?? hit.price ?? null;
    const currency = hit.currency_code || 'AED';
    const price = rawPrice != null
      ? `${parseFloat(String(rawPrice)).toFixed(2)} ${currency}`
      : null;

    // VARIANT ID: from Storefront lookup
    const variantInfo = hit.handle ? variantMap.get(hit.handle) : null;
    const variantId = variantInfo?.variantId || null;
    const variantSku = variantInfo?.variantSku || hit.sku || null;

    // DESCRIPTION
    const rawDesc = hit.body_html_safe || hit.body_html || '';
    const description = typeof rawDesc === 'string'
      ? rawDesc.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 500)
      : '';

    const result = {
      id: productId,
      title: hit.title || 'Untitled Product',
      handle: hit.handle || null,
      vendor: hit.vendor || null,
      image_url: imageUrl,
      url: hit.handle
        ? `https://${STOREFRONT_HOST}/products/${hit.handle}`
        : null,
      price,
      description,
      variant_id: variantId,
      merchandise_id: variantId,
      sku: variantSku,
    };

    if (!imageUrl) {
      console.warn(`[Algolia] No image for "${hit.title}" — product_image=${hit.product_image}`);
    }
    if (!variantId) {
      console.warn(`[Algolia] No variant_id for "${hit.title}" handle="${hit.handle}"`);
    }

    return result;
  });

  return { products };
}
