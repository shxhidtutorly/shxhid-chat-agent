/**
 * Search Router — v5.0 (Simplified)
 *
 * Two paths only:
 *   SKU → Admin productVariants exact lookup (then Storefront fallback)
 *   Everything else → Storefront `search` (plain text, no filters)
 *
 * No brand gates. No vendor filters. No query classification beyond SKU
 * detection. Trust Shopify's search relevance ranking.
 *
 * Shopify docs:
 *   Storefront search:        https://shopify.dev/docs/api/storefront/latest/queries/search
 *   Admin productVariants:    https://shopify.dev/docs/api/admin-graphql/latest/queries/productVariants
 */

import { isAlgoliaConfigured, algoliaSearch } from './algolia.server.js';

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
 * SKU detection — patterns ordered by specificity.
 * Returns the SKU string if matched, null otherwise.
 *
 * Patterns:
 *   1. Standard alphanumeric SKU (≥6 chars):     ABC123, SKU-456-789, PROD_001
 *   2. Thread/metric standards (single word):    M12-1.5, G1/2, 3/4NPT, M8x1.25
 *   3. Explicit SKU/Part prefix:                 "SKU: ABC123", "part# 12345"
 *   4. Fraction-based parts (single word):       1/2BSP, 3/4NPT
 *   5. Mixed alphanumeric short codes:           ACS580, MGPM12 (≥5 chars,
 *                                                must have both letters & digits)
 */
function detectSku(message) {
  const normalized = message.trim();
  if (!normalized) return null;

  // Pattern 3 first: explicit "SKU: X" / "part# X" wins regardless of word count
  const explicitPrefix = normalized.match(/(?:sku|part(?:\s*#)?)[:\s]+([A-Z0-9][A-Z0-9\-_\.\/]{2,})/i);
  if (explicitPrefix) return explicitPrefix[1];

  const words = normalized.split(/\s+/);
  if (words.length !== 1) return null; // SKU patterns are single-token only

  const token = words[0];

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

  // Pattern 4: Fraction-based part codes (1/2, 3/4NPT)
  if (/^\d+\/\d+[A-Z]*$/i.test(token)) {
    return token;
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
  const followUp = /\b(other brand|another brand|different brand|any other|something else|other option|alternative|instead|other model|another model|similar to|like that|like this|show more|more like|anything else|what else|do you have|do you carry|can you show|tell me more|what about|how about)\b/i;
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
 */
async function handleTextSearch(query, shopDomain) {
  console.log(`[SearchRouter] text search: "${query}"`);

  // TIER 1: Algolia — best relevance at 200k+ scale
  if (isAlgoliaConfigured()) {
    try {
      const result = await algoliaSearch(query, { first: 20 });
      if (result?.products?.length > 0) {
        console.log(
          `[SearchRouter] Algolia: ${result.products.length} results for "${query}"`
        );
        return formatStorefrontResult(result.products, 'algolia_search', query);
      }
      console.log(`[SearchRouter] Algolia: 0 results — trying Storefront fallback`);
    } catch (err) {
      console.warn(`[SearchRouter] Algolia failed (${err.message}) — falling back`);
    }
  }

  // TIER 2: Storefront search fallback
  const { searchWithStorefront } = await import('../storefront-service.js');
  const tried = new Set();
  const attempts = [];

  const tryQuery = async (q, strategy) => {
    if (!q || typeof q !== 'string') return null;
    const t = q.trim();
    if (!t || tried.has(t.toLowerCase())) return null;
    tried.add(t.toLowerCase());
    try {
      const r = await searchWithStorefront(t, { first: 20, shopDomain });
      const count = r?.products?.length || 0;
      attempts.push({ strategy, query: t, count });
      return count > 0 ? { result: r, strategy, query: t } : null;
    } catch (err) {
      console.warn(`[SearchRouter] ${strategy} failed: ${err.message}`);
      return null;
    }
  };

  let hit = await tryQuery(query, 'original');
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

export async function smartSearch(userMessage, shopDomain) {
  if (!userMessage || !shopDomain) return null;
  const trimmed = userMessage.trim();
  if (!trimmed) return null;

  if (isConversationalMessage(trimmed)) {
    return null;
  }

  const skuToken = detectSku(trimmed);
  if (skuToken) {
    const skuResult = await handleSkuSearch(skuToken, trimmed, shopDomain);
    if (skuResult) return skuResult;
    // SKU not found anywhere — fall through to plain text search using the
    // original message, so the user gets *something* rather than a dead end.
    console.log(`[SearchRouter] SKU "${skuToken}" not found — falling back to text search`);
  }

  return await handleTextSearch(trimmed, shopDomain);
}
