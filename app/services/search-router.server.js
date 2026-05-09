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

function looksLikeSku(token) {
  if (!token || token.length < 4) return false;
  const t = token.replace(/\s+/g, "");
  if (!/[A-Za-z]/.test(t) || !/\d/.test(t)) return false;
  if (!/^[A-Za-z0-9\-\.\/]+$/.test(t)) return false;
  // Skip pure measurements: 24VDC, 18MM, 100A
  if (/^\d+(?:MM|CM|VDC|VAC|V|A|W|KW|HP|INCH|IN|FT|FEET|FOOT)$/i.test(t)) return false;
  return true;
}

function extractSkuToken(message) {
  const words = message.split(/\s+/);
  if (words.length <= 2) {
    const candidate = words.length === 1 ? words[0] : words.join("");
    if (looksLikeSku(candidate)) return candidate;
  }
  for (const word of words) {
    if (looksLikeSku(word) && word.length >= 5) return word;
  }
  return null;
}

function isConversationalMessage(msg) {
  const lower = msg.toLowerCase().trim();
  if (lower.length < 3) return true;
  const chatPrefix = /^(hi|hello|hey|thanks|thank you|ok|okay|yes|no|please|help|how|what|why|when|where|who|can you|do you|i need|i want|show me|find me|looking for|search for)\b/i;
  if (chatPrefix.test(lower)) {
    const remainder = lower.replace(chatPrefix, "").trim();
    if (remainder.length < 2) return true;
    return false; // has substance — let it search
  }
  return false;
}

function simplifyQuery(query) {
  const fillers = /\b(show|me|find|search|for|looking|do|you|have|some|any|the|a|an|please|can|i|need|want)\b/gi;
  const simplified = query.replace(fillers, "").replace(/\s+/g, " ").trim();
  return simplified.length >= 3 ? simplified : null;
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

async function handleTextSearch(query, shopDomain) {
  console.log(`[SearchRouter] text search: "${query}" → storefront search`);

  try {
    const { searchWithStorefront } = await import("../storefront-service.js");
    const result = await searchWithStorefront(query, { first: 20, shopDomain });

    if (!result || !result.products || result.products.length === 0) {
      const simplified = simplifyQuery(query);
      if (simplified && simplified !== query) {
        console.log(`[SearchRouter] retrying with simplified query: "${simplified}"`);
        const retry = await searchWithStorefront(simplified, { first: 20, shopDomain });
        if (retry?.products?.length > 0) {
          return formatStorefrontResult(
            retry.products.map(storefrontProductToCardShape),
            "storefront_search_simplified",
            simplified
          );
        }
      }
      return null;
    }

    return formatStorefrontResult(
      result.products.map(storefrontProductToCardShape),
      "storefront_search",
      query
    );
  } catch (err) {
    console.warn(`[SearchRouter] Storefront search failed: ${err.message}`);
    return null;
  }
}

export async function smartSearch(userMessage, shopDomain) {
  if (!userMessage || !shopDomain) return null;
  const trimmed = userMessage.trim();
  if (!trimmed) return null;

  if (isConversationalMessage(trimmed)) {
    return null;
  }

  const skuToken = extractSkuToken(trimmed);
  if (skuToken) {
    return await handleSkuSearch(skuToken, trimmed, shopDomain);
  }

  return await handleTextSearch(trimmed, shopDomain);
}
