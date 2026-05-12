/**
 * Tool Service — v5.0 (NO GATES)
 *
 * Processes MCP tool responses (product search, cart updates).
 *
 * v5.0 — May 9, 2026 — REMOVED ALL GATES
 *   - Removed distinctive-token strict gate
 *   - Removed brand coherence gate (KNOWN_BRANDS, detectBrandQuery, etc.)
 *   - Removed voltage filter
 *   - Removed category coherence scoring
 *   - Removed inch-dimension gate
 *
 * KEPT:
 *   - Image extraction (extractImageUrl)
 *   - Price formatting (formatPrice)
 *   - Description extraction (extractDescription)
 *   - Product URL resolution (resolveProductUrl)
 *   - SKU spec scoring for re-ranking (scoreProductBySpecs)
 *   - Cart processing (processCartUpdateResult)
 *
 * Trust the search engine: Storefront `search` already ranks by relevance.
 * Re-rank only when the user typed a SKU (so the exact match floats to top).
 */

function extractAmount(val) {
  if (val === null || val === undefined) return null;
  if (typeof val === "string") return val.trim() || null;
  if (typeof val === "number") return String(val);
  if (typeof val === "object") {
    if (val.amount !== undefined && val.amount !== null) return String(val.amount);
    if (val.value !== undefined && val.value !== null) return String(val.value);
    if (val.price !== undefined && val.price !== null) {
      const inner = val.price;
      if (typeof inner === "string" || typeof inner === "number") return String(inner);
    }
  }
  return null;
}

function extractCurrency(val, fallback = "") {
  if (!val) return fallback;
  if (typeof val === "string") return /^[A-Z]{3}$/.test(val) ? val : fallback;
  if (typeof val === "object") return val.currency_code || val.currencyCode || val.currency || fallback;
  return fallback;
}

function formatPrice(p) {
  if (!p || typeof p !== "object") return "";

  if (p.price !== undefined && p.price !== null) {
    const amt = extractAmount(p.price);
    const curr = extractCurrency(p.price, p.currency || p.currency_code || p.currencyCode || "");
    if (amt) return curr ? `${amt} ${curr}` : amt;
  }

  if (p.price_range && typeof p.price_range === "object") {
    const pr = p.price_range;
    const minAmt = extractAmount(pr.min);
    const maxAmt = extractAmount(pr.max);
    const currency = extractCurrency(pr.currency, "") || extractCurrency(pr.min, "") || extractCurrency(pr.max, "") || extractCurrency(p.currency || p.currency_code, "") || "USD";
    if (minAmt && maxAmt && minAmt !== maxAmt) return `${minAmt} - ${maxAmt} ${currency}`;
    if (minAmt) return `${minAmt} ${currency}`;
    if (maxAmt) return `${maxAmt} ${currency}`;
  }

  if (p.priceRange && typeof p.priceRange === "object") {
    const minV = p.priceRange.minVariantPrice;
    if (minV) {
      const amt = extractAmount(minV);
      const curr = extractCurrency(minV);
      if (amt) return curr ? `${amt} ${curr}` : amt;
    }
  }

  if (Array.isArray(p.variants) && p.variants.length > 0) {
    for (const v of p.variants) {
      if (!v) continue;
      const amt = extractAmount(v.price);
      if (amt) {
        const curr = extractCurrency(v.price, v.currency || v.currency_code || v.currencyCode || "");
        return curr ? `${amt} ${curr}` : amt;
      }
    }
  }

  return "";
}

function extractQuerySpecs(query) {
  if (!query || typeof query !== "string") return { skuPatterns: [] };

  const skuRegex = /\b([A-Z0-9][A-Z0-9\-\.\/]{1,}[A-Z0-9])\b/gi;
  const skuPatterns = [];
  let m;
  while ((m = skuRegex.exec(query)) !== null) {
    const token = m[1].toUpperCase();
    if (!/\d/.test(token) || !/[A-Z]/i.test(token)) continue;
    const hasSeparator = /[-\.\/]/.test(token);
    if (token.length < 5 && !hasSeparator) continue;
    // Skip pure measurements (24V, 18MM, IP67, etc.)
    if (/^\d+(?:MM|CM|VDC|VAC|V|A|W|KW|HP|INCH|IN|FT)$/i.test(token)) continue;
    if (/^IP\d{2}$/i.test(token)) continue;
    skuPatterns.push(token);
  }

  return { skuPatterns };
}

function scoreProductBySpecs(product, specs) {
  if (!specs.skuPatterns || specs.skuPatterns.length === 0) return 0;

  const productSku = String(product.sku || "").toUpperCase();
  const variantSkus = (product.variants || []).map((v) => String(v.sku || "").toUpperCase());
  const titleUpper = String(product.title || "").toUpperCase();

  let score = 0;
  for (const sku of specs.skuPatterns) {
    const skuU = sku.toUpperCase();
    const skuN = skuU.replace(/[-\.\/]/g, "");
    const titleN = titleUpper.replace(/[-\.\/]/g, "");

    if (variantSkus.some((s) => s === skuU) || productSku === skuU) score += 1000;
    else if (variantSkus.some((s) => s.includes(skuU)) || productSku.includes(skuU)) score += 800;
    else if (variantSkus.some((s) => s.replace(/[-\.\/]/g, "").includes(skuN)) || productSku.replace(/[-\.\/]/g, "").includes(skuN)) score += 600;
    else if (titleUpper.includes(skuU) || titleN.includes(skuN)) score += 400;
  }

  return score;
}

/**
 * Generic relevance score (independent of SKU). Used to re-rank text-search
 * results so exact / starts-with title matches float above loose matches.
 */
function scoreProductByRelevance(product, query) {
  if (!query || typeof query !== "string") return 0;
  const q = query.toLowerCase().trim();
  if (!q) return 0;

  const title = String(product.title || "").toLowerCase();
  let score = 0;

  if (title === q) score += 500;
  else if (title.startsWith(q)) score += 200;

  const queryWords = q.split(/\s+/).filter((w) => w.length >= 2);
  if (queryWords.length > 0) {
    const titleWords = title.split(/\s+/);
    const matches = queryWords.filter((w) => titleWords.includes(w)).length;
    score += matches * 50;
  }

  // Small bonuses to break ties — prefer in-stock and image-bearing products
  const variants = Array.isArray(product.variants) ? product.variants : [];
  const anyAvailable = variants.some((v) => v?.available || v?.availableForSale);
  if (anyAvailable) score += 20;
  if (product.image_url) score += 10;

  return score;
}

/**
 * Extract a clean plain-text description from a product object.
 */
function extractDescription(product) {
  const raw = product.description;

  if (typeof raw === "string") {
    return raw.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().substring(0, 500);
  }

  if (raw && typeof raw === "object") {
    const val = raw.value || raw.text || raw.html || raw.content || raw.body || "";
    if (typeof val === "string") {
      return val.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().substring(0, 500);
    }
  }

  const html = product.descriptionHtml || product.body_html || product.bodyHtml || "";
  if (typeof html === "string" && html) {
    return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().substring(0, 500);
  }

  return "";
}

/**
 * Extract a valid image URL from a product object.
 *
 * Tries every known shape — MCP, Storefront GraphQL (edges/nodes), Admin REST,
 * legacy formats. Returns the first URL that starts with "http".
 */
function extractImageUrl(product) {
  if (!product) return null;

  const paths = [
    // MCP search_catalog confirmed shape from production logs:
    // media[0] = { type: "image", url: "...", alt_text: "..." }
    () => product.media?.[0]?.url,
    () => product.media?.[0]?.src,
    // Also check nested .image in case MCP version changes
    () => product.media?.[0]?.image?.url,
    () => product.media?.[0]?.image?.src,
    () => product.media?.[0]?.preview_image?.src,
    () => product.media?.[0]?.preview_image?.url,
    // Iterate all media items (not just [0]) as a fallback
    () => product.media?.find(m => m?.url?.startsWith('http'))?.url,
    () => product.media?.find(m => m?.image?.url)?.image?.url,

    // featured_media variants
    () => product.featured_media?.image?.url,
    () => product.featured_media?.preview_image?.src,
    () => product.featured_media?.preview_image?.url,
    () => product.featured_media?.url,
    () => product.featured_media?.src,

    // Flat URL fields
    () => (typeof product.image_url === "string" ? product.image_url : null),
    () => (typeof product.thumbnail_url === "string" ? product.thumbnail_url : null),
    () => (typeof product.thumbnail === "string" ? product.thumbnail : null),

    // featured_image (REST / snake_case)
    () => (typeof product.featured_image === "string" ? product.featured_image : null),
    () => product.featured_image?.url,
    () => product.featured_image?.src,

    // featuredImage (GraphQL camelCase)
    () => product.featuredImage?.url,
    () => product.featuredImage?.src,
    () => product.featuredImage?.image?.url,
    () => (typeof product.featuredImage === "string" ? product.featuredImage : null),

    // image (single object or string)
    () => (typeof product.image === "string" ? product.image : null),
    () => product.image?.url,
    () => product.image?.src,

    // images array (multiple shapes)
    () => product.images?.[0]?.url,
    () => product.images?.[0]?.src,
    () => (typeof product.images?.[0] === "string" ? product.images[0] : null),
    () => product.images?.edges?.[0]?.node?.url,
    () => product.images?.edges?.[0]?.node?.src,
    () => product.images?.nodes?.[0]?.url,
    () => product.images?.nodes?.[0]?.src,
    () => product.images?.image?.url,

    // variant images (last resort)
    () => product.variants?.[0]?.image?.url,
    () => product.variants?.[0]?.image?.src,
    () => (typeof product.variants?.[0]?.image === "string" ? product.variants[0].image : null),
    () => product.variants?.nodes?.[0]?.image?.url,
    () => product.variants?.edges?.[0]?.node?.image?.url,
  ];

  for (const get of paths) {
    try {
      const url = get();
      if (typeof url === "string" && url.startsWith("http")) return url;
    } catch (_e) {
      // path doesn't exist on this product shape, continue
    }
  }

  console.warn(
    `[ImageDebug] No valid image URL for product: id=${product.id || "?"} title="${(product.title || "").slice(0, 60)}" keys=[${Object.keys(product).join(", ")}]`
  );
  return null;
}

export function createToolService() {
  const MAX_PRODUCTS_TO_DISPLAY = 12;

  function resolveProductUrl(product, shopDomain) {
    if (product.handle) return `https://${shopDomain}/products/${product.handle}`;
    const rawUrl = product.product_url || product.url || "";
    if (rawUrl) {
      const productsMatch = rawUrl.match(/\/products\/([a-z0-9][a-z0-9\-]*)/i);
      if (productsMatch && productsMatch[1]) return `https://${shopDomain}/products/${productsMatch[1]}`;
      if (rawUrl.startsWith("http")) return rawUrl;
    }
    return null;
  }

  const processProductSearchResult = (toolUseResponse, shopDomain, userQuery, searchQuery) => {
    try {
      if (!toolUseResponse?.content || toolUseResponse.content.length === 0) return [];

      const contentText = toolUseResponse.content[0].text;
      let responseData;
      try {
        responseData = typeof contentText === "string" ? JSON.parse(contentText) : contentText;
      } catch (e) {
        console.error("[ToolService] Failed to parse tool content:", e.message);
        return [];
      }

      const rawProducts =
        (Array.isArray(responseData?.products) && responseData.products) ||
        (Array.isArray(responseData?.items) && responseData.items) ||
        (Array.isArray(responseData?.results) && responseData.results) ||
        [];

      if (rawProducts.length === 0) return [];

      console.log(`[ToolService] Search returned ${rawProducts.length} products`);

      // Map products into the frontend card shape.
      const mappedProducts = rawProducts.map((p) => {
        const firstVariant =
          Array.isArray(p.variants) && p.variants.length > 0 ? p.variants[0] : null;
        const variantId = firstVariant?.id || firstVariant?.variant_id || null;
        return {
          id: p.product_id || p.id,
          title: p.title || "Untitled Product",
          handle: p.handle || null,
          vendor: p.vendor || null,
          image_url: extractImageUrl(p),
          url: resolveProductUrl(p, shopDomain),
          price: formatPrice(p),
          description: extractDescription(p),
          variant_id: variantId,
          merchandise_id: variantId,
          sku: p.sku || firstVariant?.sku || null,
          // Carry through fields needed for SKU re-ranking, then strip.
          _variants: Array.isArray(p.variants) ? p.variants : [],
        };
      });

      // Re-rank: exact SKU > title-equality > title-starts-with > word-overlap
      //          > availability > has-image. Always relevance-rank; add SKU
      //          score on top when the user typed a SKU-like token.
      const userSpecs = extractQuerySpecs(userQuery || "");
      const searchSpecs = extractQuerySpecs(searchQuery || "");
      const skuPatterns = [...new Set([...userSpecs.skuPatterns, ...searchSpecs.skuPatterns])];
      const rankQuery = (searchQuery || userQuery || "").trim();

      if (skuPatterns.length > 0) {
        console.log(`[ToolService] SKU re-rank for: [${skuPatterns.join(", ")}]`);
      }

      const ranked = [...mappedProducts].sort((a, b) => {
        const skuA = skuPatterns.length > 0
          ? scoreProductBySpecs({ sku: a.sku, title: a.title, variants: a._variants }, { skuPatterns })
          : 0;
        const skuB = skuPatterns.length > 0
          ? scoreProductBySpecs({ sku: b.sku, title: b.title, variants: b._variants }, { skuPatterns })
          : 0;
        const relA = scoreProductByRelevance({ ...a, variants: a._variants }, rankQuery);
        const relB = scoreProductByRelevance({ ...b, variants: b._variants }, rankQuery);
        return (skuB + relB) - (skuA + relA);
      });

      ranked.forEach((p) => { delete p._variants; });
      console.log(`[ToolService] Re-ranked top: "${ranked[0]?.title || ""}"`);

      console.log(`[ToolService] Returning ${Math.min(ranked.length, MAX_PRODUCTS_TO_DISPLAY)} products`);
      return ranked.slice(0, MAX_PRODUCTS_TO_DISPLAY);
    } catch (error) {
      console.error("[ToolService] Error processing product search results:", error);
      return [];
    }
  };

  const processCartUpdateResult = (toolUseResponse) => {
    if (!toolUseResponse || toolUseResponse.error) return { checkoutUrl: null, cart: null };

    try {
      const raw = toolUseResponse.content?.[0]?.text ?? toolUseResponse.content?.[0]?.data;
      const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;

      if (!parsed || typeof parsed !== "object") return { checkoutUrl: null, cart: null };

      const checkoutUrl =
        parsed.checkout_url ||
        parsed.checkoutUrl ||
        parsed.cart?.checkoutUrl ||
        parsed.cart?.checkout_url ||
        parsed.data?.cart?.checkoutUrl ||
        parsed.data?.cart?.checkout_url ||
        null;

      const cart = parsed.cart || parsed.data?.cart || parsed;
      if (checkoutUrl) console.log(`[ToolService] Checkout URL: ${checkoutUrl.substring(0, 60)}...`);
      return { checkoutUrl, cart };
    } catch (error) {
      console.error("[ToolService] Error processing cart update result:", error);
      return { checkoutUrl: null, cart: null };
    }
  };

  return { processProductSearchResult, processCartUpdateResult };
}

export default { createToolService };
