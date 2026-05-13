/**
 * Search Router — v5.1 (Production Fix)
 *
 * CHANGES (v5.1 — May 2026):
 *
 * CRITICAL BUG FIX: matchSkuToken Pattern 4 was too broad.
 *   The old regex `^\d+\/\d+[A-Z]*$` matched ANY fraction because [A-Z]* allows
 *   ZERO letters. This caused "1/4", "5/2", "3/4" etc. to be classified as SKUs,
 *   triggering an admin lookup that fails, then a storefront search for "1/4"
 *   which returns 18,000+ completely irrelevant products.
 *
 *   Fixed: Pattern 4 now requires 2+ INDUSTRIAL letters after the fraction
 *   (NPT, BSP, BSPP, BSPT, etc.) and explicitly excludes dimension units
 *   (INCH, IN, FT, MM, CM). Pure fractions and valve configs (1/4, 5/2, 3/4)
 *   are NOT SKUs — they fall through to handleTextSearch where QueryIntel
 *   correctly interprets them in context.
 *
 * RESULT COUNT: Reduced from 20 to 10 across all search paths.
 *
 * Two paths only:
 *   SKU → Admin productVariants exact lookup (then Storefront fallback)
 *   Everything else → Storefront `search` (plain text, no filters)
 *
 * Shopify docs:
 *   Storefront search:        https://shopify.dev/docs/api/storefront/latest/queries/search
 *   Admin productVariants:    https://shopify.dev/docs/api/admin-graphql/latest/queries/productVariants
 */

import { isAlgoliaConfigured, algoliaSearch } from './algolia.server.js';
import { rewriteQueryForSearch } from './query-intelligence.server.js';

const STOREFRONT_HOST = "creativeautomation.ae"; // public storefront for product URLs

function plainTextFromHtml(html) {
  if (!html || typeof html !== "string") return "";
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function formatPrice(priceRangeV2) {
  if (!priceRangeV2) return null;
  const min = priceRangeV2.minVariantPrice;
  const max = priceRangeV2.maxVariantPrice;
  if (!min) return null;
  const fmt = (p) => `${parseFloat(p.amount).toFixed(2)} ${p.currencyCode || "AED"}`;
  if (max && parseFloat(max.amount) !== parseFloat(min.amount)) {
    return `${fmt(min)} - ${fmt(max)}`;
  }
  return fmt(min);
}

function pickImageUrl(product) {
  const featured = product?.featuredMedia?.preview?.image?.url;
  if (featured) return featured;
  const first = product?.images?.nodes?.[0]?.url;
  return first || null;
}

function productUrlFor(handle) {
  return `https://www.${STOREFRONT_HOST}/products/${handle}`;
}

function skuVariantToCardShape(variant) {
  const product = variant.product || {};
  return {
    id: product.id,
    title: product.title || "Untitled Product",
    handle: product.handle || null,
    vendor: product.vendor || null,
    image_url: pickImageUrl(product),
    url: product.handle ? productUrlFor(product.handle) : null,
    price: formatPrice(product.priceRangeV2),
    description: plainTextFromHtml(product.descriptionHtml).slice(0, 500),
    variant_id: variant.id,
    merchandise_id: variant.id,
    sku: variant.sku || null,
    _matchedSku: variant.sku || null,
  };
}

function storefrontProductToCardShape(p) {
  const firstVariant = (p.variants && p.variants[0]) || null;
  return {
    id: p.id,
    title: p.title || "Untitled Product",
    handle: p.handle || null,
    vendor: p.vendor || null,
    image_url: p.image_url || p.featuredImage?.url || null,
    url: p.handle ? productUrlFor(p.handle) : null,
    price: p.priceRange ? formatPrice(p.priceRange) : null,
    description: typeof p.description === "string" ? p.description.slice(0, 500) : "",
    variant_id: firstVariant?.id || null,
    merchandise_id: firstVariant?.id || null,
    sku: firstVariant?.sku || p.sku || null,
  };
}

function dedupeById(items) {
  const seen = new Set();
  const out = [];
  for (const it of items) {
    if (!it || !it.id || seen.has(it.id)) continue;
    seen.add(it.id);
    out.push(it);
  }
  return out;
}

/**
 * SKU detection — scans every whitespace-separated token in the message.
 * Returns the first SKU-like string found, or null.
 *
 * CRITICAL FIX v5.1:
 *   Pattern 4 now requires INDUSTRIAL THREAD SUFFIX (2+ letters, not dimension units).
 *   This prevents "1/4", "5/2", "3/4" from being classified as SKUs when they
 *   are dimensions ("1/4 Inch AODD Pumps") or valve configs ("5/2 way solenoid valve").
 *
 * Pattern coverage (single token):
 *   1. Standard alphanumeric SKUs (≥6 chars):     ABC123, SKU-456-789, PROD_001
 *   2. Thread/metric standards:                  M12-1.5, G1/2, 3/4NPT, M8x1.25
 *   3. Explicit SKU/Part prefix:                 "SKU: ABC123", "part# 12345"
 *   4. Fraction WITH industrial thread suffix:   1/4NPT, 3/4BSP, 1/2BSPP (NOT plain 1/4, 5/2)
 *   5. Mixed alphanumeric short codes (≥5 chars, has letter+digit)
 */
function detectSku(message) {
  const normalized = message.trim();
  if (!normalized) return null;

  // Pattern 3 first: explicit "SKU: X" / "part# X" wins regardless of word count
  const explicitPrefix = normalized.match(/(?:sku|part(?:\s*#)?)[:\s]+([A-Z0-9][A-Z0-9\-_\.\/]{2,})/i);
  if (explicitPrefix) return explicitPrefix[1];

  // Strip leading/trailing punctuation off each token, then test in order.
  const tokens = normalized
    .split(/\s+/)
    .map((w) => w.replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, ""))
    .filter(Boolean);

  for (const token of tokens) {
    const candidate = matchSkuToken(token);
    if (candidate) return candidate;
  }

  return null;
}

function matchSkuToken(token) {
  if (!token) return null;

  // Skip pure measurement tokens: 24VDC, 18MM, 100A, IP67, 2INCH
  if (/^\d+(?:MM|CM|VDC|VAC|V|A|W|KW|HP|INCH|IN|FT|FEET|FOOT)$/i.test(token)) return null;
  if (/^IP\d{2}$/i.test(token)) return null;

  // Pattern 1: Standard alphanumeric SKUs (≥6 chars, contains digit+letter)
  if (/^[A-Z0-9][A-Z0-9\-_]{5,}$/i.test(token) && /[A-Za-z]/.test(token) && /\d/.test(token)) {
    return token;
  }

  // Pattern 2: Thread/metric (e.g. M12-1.5, G1/2, M8x1.25, 3/4NPT)
  if (/^[A-Z]*\d+[xX\-\/\.]\d+(?:[\.\d]*)?[A-Z]*$/i.test(token)) {
    return token;
  }

  // Pattern 4 (FIXED v5.1): Fraction-based part codes WITH industrial suffix ONLY
  //
  // ALLOWED (industrial thread standards):
  //   1/4NPT → NPT = National Pipe Thread ✅
  //   3/4BSP → BSP = British Standard Pipe ✅
  //   1/2BSPP → BSPP = BSP Parallel ✅
  //   1/2BSPT → BSPT = BSP Tapered ✅
  //
  // REJECTED (dimensions or valve configs — NOT SKUs):
  //   1/4   → no suffix: bare fraction = dimension ("1/4 Inch AODD Pump") ✅
  //   5/2   → no suffix: valve config = "5 ports / 2 positions" ✅
  //   3/4   → no suffix: bare fraction = pipe size designation ✅
  //   1/4INCH → dimension unit suffix ✅
  //   1/4IN   → dimension unit suffix ✅
  //
  // Requires: 2+ letters after fraction AND NOT a dimension unit
  if (/^\d+\/\d+[A-Z]{2,}$/i.test(token)) {
    const suffix = (token.match(/[A-Z]+$/i) || [''])[0].toUpperCase();
    const dimensionUnits = new Set(['INCH', 'INCHES', 'IN', 'FT', 'FEET', 'FOOT', 'MM', 'CM', 'KM', 'UM']);
    if (!dimensionUnits.has(suffix)) return token;
  }

  // Pattern 5: Short mixed alphanumeric codes (≥5 chars, has letter+digit)
  // Catches ACS580, MGPM12, 6SL3220
  if (token.length >= 5 && /[A-Za-z]/.test(token) && /\d/.test(token) && /^[A-Z0-9\-\.\/]+$/i.test(token)) {
    return token;
  }

  return null;
}

function isConversationalMessage(msg) {
  if (!msg || typeof msg !== 'string') return true;
  const lower = msg.toLowerCase().trim();
  if (lower.length < 3) return true;

  // Pure greetings/acks with no product substance
  const pureChat = /^(hi|hello|hey|thanks|thank you|ok|okay|yes|no|sure|got it|great|perfect|sounds good|appreciate it|noted|understood|alright|cool|nice|good|fine)[\s!?.]*$/i;
  if (pureChat.test(lower)) return true;

  // Follow-up questions about previous results — NOT new searches
  const followUp = /\b(other brand|another brand|different brand|any other|something else|other option|alternative|instead|other model|another model|similar to|like that|like this|show more|more like|anything else|what else|can you show|tell me more|what about|how about)\b/i;
  if (followUp.test(lower)) return true;

  // Clarifications referencing "the" / "that" / "these" —
  // they refer to already-shown results, not new queries
  const clarification = /^(the (first|second|third|last|one|product|item)|that (one|product|item)|these|those|this one|all of them|both|which one)\b/i;
  if (clarification.test(lower)) return true;

  return false;
}

function simplifyQuery(query) {
  // Drop common chat fillers AND generic industrial modifiers
  const fillers = /\b(show|me|find|search|for|looking|do|you|have|some|any|the|a|an|please|can|i|need|want|industrial|commercial|heavy|duty|professional|grade)\b/gi;
  const simplified = query.replace(fillers, "").replace(/\s+/g, " ").trim();
  return simplified.length >= 3 ? simplified : null;
}

function pluralSingularVariant(query) {
  const words = query.split(/\s+/);
  if (words.length === 0) return null;
  const last = words[words.length - 1];
  if (last.length < 4) return null;
  const variant = last.endsWith("s") ? last.slice(0, -1) : last + "s";
  if (variant === last) return null;
  return [...words.slice(0, -1), variant].join(" ");
}

function mainNoun(query) {
  const words = query.split(/\s+/).filter((w) => w.length >= 3);
  if (words.length <= 1) return null;
  // Heuristic: the last token is usually the noun ("ABB relay" → "relay")
  return words[words.length - 1];
}

function formatStorefrontResult(products, searchType, query) {
  return {
    products,
    searchType,
    systemHint: `Found ${products.length} product(s) for "${query}". Acknowledge briefly — cards are already displayed.`,
  };
}

async function handleSkuSearch(sku, originalMessage, shopDomain) {
  console.log(`[SearchRouter] SKU detected: "${sku}" → admin lookup`);

  // Step 1: Admin API exact SKU lookup
  try {
    const { searchBySku } = await import("./admin-products.server.js");
    const result = await searchBySku(shopDomain, sku);
    if (result && result.type !== "none" && result.variants.length > 0) {
      const products = dedupeById(result.variants.map(skuVariantToCardShape));
      if (products.length > 0) {
        return {
          products,
          searchType: result.type === "exact" ? "sku_exact" : "sku_partial",
          systemHint:
            result.type === "exact"
              ? `Found exact SKU match for "${sku}". Acknowledge briefly — the product card is already shown.`
              : `Found similar products for "${sku}". Tell the user no exact match was found and these are alternatives.`,
        };
      }
    }
  } catch (err) {
    console.warn(`[SearchRouter] Admin SKU search failed: ${err.message}`);
  }

  // Step 2: Storefront search fallback (indexes variant.sku too)
  try {
    const { searchWithStorefront } = await import("../storefront-service.js");
    const result = await searchWithStorefront(sku, { first: 10, shopDomain });
    if (result?.products?.length > 0) {
      return {
        products: result.products.map(storefrontProductToCardShape),
        searchType: "sku_storefront_fallback",
        systemHint: `No exact SKU match for "${sku}" in our system. Showing related products that may be alternatives.`,
      };
    }

    // Step 3: Try without separators
    const noSep = sku.replace(/[-\.\/]/g, "");
    if (noSep !== sku && noSep.length >= 3) {
      const retry = await searchWithStorefront(noSep, { first: 10, shopDomain });
      if (retry?.products?.length > 0) {
        return {
          products: retry.products.map(storefrontProductToCardShape),
          searchType: "sku_nosep_fallback",
          systemHint: `No exact match for "${sku}". Showing products matching "${noSep}".`,
        };
      }
    }
  } catch (err) {
    console.warn(`[SearchRouter] Storefront SKU fallback failed: ${err.message}`);
  }

  return null;
}

/**
 * 4-tier fallback strategy:
 *   1. Original query
 *   2. Plural/singular variation of the last word
 *   3. Simplified (drop fillers and generic modifiers)
 *   4. Main noun only (last 3+ char word)
 *
 * Stops on the first attempt that returns ≥1 product.
 * All searches capped at first: 10 (was 20).
 */
async function handleTextSearch(query, shopDomain, conversationHistory = []) {
  console.log(`[SearchRouter] text search: "${query}"`);

  // ── Query Intelligence: rewrite query for best Algolia results ──
  let algoliaQuery = query;
  let skipAlgolia = false;

  if (isAlgoliaConfigured()) {
    try {
      const intel = await rewriteQueryForSearch(query, conversationHistory);
      skipAlgolia = intel.skip;
      algoliaQuery = intel.query || query;
    } catch (err) {
      console.warn(`[SearchRouter] Query intelligence failed: ${err.message}`);
      algoliaQuery = query;
    }
  }

  // TIER 1: Algolia — best relevance for brand/product-type queries
  if (isAlgoliaConfigured() && !skipAlgolia && algoliaQuery) {
    try {
      // Cap at 10 results (was 20)
      const result = await algoliaSearch(algoliaQuery, { first: 10, shopDomain });
      if (result?.products?.length > 0) {
        console.log(
          `[SearchRouter] Algolia: ${result.products.length} results for "${algoliaQuery}"`
        );
        return formatStorefrontResult(result.products, 'algolia_search', algoliaQuery);
      }
      console.log(`[SearchRouter] Algolia: 0 results for "${algoliaQuery}" — trying Storefront`);
    } catch (err) {
      console.warn(`[SearchRouter] Algolia failed (${err.message}) — falling back`);
    }
  }

  // TIER 2: Storefront search — better for spec/attribute queries
  const { searchWithStorefront } = await import('../storefront-service.js');
  const tried = new Set();
  const attempts = [];

  const tryQuery = async (q, strategy) => {
    if (!q || typeof q !== 'string') return null;
    const t = q.trim();
    if (!t || tried.has(t.toLowerCase())) return null;
    tried.add(t.toLowerCase());
    try {
      // Cap at 10 results (was 20)
      const r = await searchWithStorefront(t, { first: 10, shopDomain });
      const count = r?.products?.length || 0;
      attempts.push({ strategy, query: t, count });
      return count > 0 ? { result: r, strategy, query: t } : null;
    } catch (err) {
      console.warn(`[SearchRouter] ${strategy} failed: ${err.message}`);
      return null;
    }
  };

  let hit = await tryQuery(query, 'original');
  if (!hit && algoliaQuery !== query) hit = await tryQuery(algoliaQuery, 'rewritten');
  if (!hit) hit = await tryQuery(pluralSingularVariant(query), 'plural_singular');
  if (!hit) hit = await tryQuery(simplifyQuery(query), 'simplified');
  if (!hit) hit = await tryQuery(mainNoun(query), 'main_noun');

  console.log(`[SearchRouter] Storefront attempts: ${JSON.stringify(attempts)}`);
  if (!hit) return null;

  const products = hit.result.products.map(storefrontProductToCardShape);
  const searchType = hit.strategy === 'original'
    ? 'storefront_search'
    : `storefront_search_${hit.strategy}`;
  return formatStorefrontResult(products, searchType, hit.query);
}

export async function smartSearch(userMessage, shopDomain, conversationHistory = []) {
  if (!userMessage || !shopDomain) return null;
  const trimmed = userMessage.trim();
  if (!trimmed) return null;

  // SKU check FIRST — an embedded part code overrides conversational phrasing.
  // "do you have the BA25SS-STT3-A AODD pump" still resolves the SKU lookup.
  const skuToken = detectSku(trimmed);
  if (skuToken) {
    const skuResult = await handleSkuSearch(skuToken, trimmed, shopDomain);
    if (skuResult) return skuResult;
    // SKU not found anywhere — fall through to plain text search using the
    // original message, so the user gets *something* rather than a dead end.
    console.log(`[SearchRouter] SKU "${skuToken}" not found — falling back to text search`);
  }

  if (isConversationalMessage(trimmed)) {
    return null;
  }

  return await handleTextSearch(trimmed, shopDomain, conversationHistory);
}
