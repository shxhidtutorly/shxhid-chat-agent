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

    if (variantSkus.some((s) => s === skuU) || productSku === skuU) score += 250;
    else if (variantSkus.some((s) => s.includes(skuU)) || productSku.includes(skuU)) score += 200;
    else if (variantSkus.some((s) => s.replace(/[-\.\/]/g, "").includes(skuN)) || productSku.replace(/[-\.\/]/g, "").includes(skuN)) score += 150;
    else if (titleUpper.includes(skuU) || titleN.includes(skuN)) score += 100;
  }

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
 * Priority order based on production log evidence: media[].image.url is the
 * field populated by the current MCP search_catalog UCP response.
 */
function extractImageUrl(product) {
  if (Array.isArray(product.media) && product.media.length > 0) {
    for (const m of product.media) {
      if (typeof m?.image?.url === "string" && m.image.url.startsWith("http")) return m.image.url;
      if (typeof m?.image?.src === "string" && m.image.src.startsWith("http")) return m.image.src;
      if (typeof m?.preview_image?.src === "string" && m.preview_image.src.startsWith("http")) return m.preview_image.src;
      if (typeof m?.preview_image?.url === "string" && m.preview_image.url.startsWith("http")) return m.preview_image.url;
      if (typeof m?.url === "string" && m.url.startsWith("http")) return m.url;
      if (typeof m?.src === "string" && m.src.startsWith("http")) return m.src;
    }
  }

  if (product.featured_media) {
    if (typeof product.featured_media?.image?.url === "string" && product.featured_media.image.url.startsWith("http")) return product.featured_media.image.url;
    if (typeof product.featured_media?.preview_image?.src === "string" && product.featured_media.preview_image.src.startsWith("http")) return product.featured_media.preview_image.src;
    if (typeof product.featured_media?.preview_image?.url === "string" && product.featured_media.preview_image.url.startsWith("http")) return product.featured_media.preview_image.url;
    if (typeof product.featured_media?.src === "string" && product.featured_media.src.startsWith("http")) return product.featured_media.src;
    if (typeof product.featured_media?.url === "string" && product.featured_media.url.startsWith("http")) return product.featured_media.url;
  }

  if (typeof product.image_url === "string" && product.image_url.startsWith("http")) return product.image_url;
  if (typeof product.thumbnail_url === "string" && product.thumbnail_url.startsWith("http")) return product.thumbnail_url;
  if (typeof product.thumbnail === "string" && product.thumbnail.startsWith("http")) return product.thumbnail;

  if (product.featured_image) {
    if (typeof product.featured_image === "string" && product.featured_image.startsWith("http")) return product.featured_image;
    if (typeof product.featured_image?.url === "string" && product.featured_image.url.startsWith("http")) return product.featured_image.url;
    if (typeof product.featured_image?.src === "string" && product.featured_image.src.startsWith("http")) return product.featured_image.src;
  }

  if (product.featuredImage) {
    if (typeof product.featuredImage?.url === "string" && product.featuredImage.url.startsWith("http")) return product.featuredImage.url;
    if (typeof product.featuredImage?.src === "string" && product.featuredImage.src.startsWith("http")) return product.featuredImage.src;
    if (typeof product.featuredImage === "string" && product.featuredImage.startsWith("http")) return product.featuredImage;
  }

  if (product.image) {
    if (typeof product.image === "string" && product.image.startsWith("http")) return product.image;
    if (typeof product.image?.url === "string" && product.image.url.startsWith("http")) return product.image.url;
    if (typeof product.image?.src === "string" && product.image.src.startsWith("http")) return product.image.src;
  }

  if (Array.isArray(product.images) && product.images.length > 0) {
    for (const img of product.images) {
      if (typeof img === "string" && img.startsWith("http")) return img;
      if (typeof img?.url === "string" && img.url.startsWith("http")) return img.url;
      if (typeof img?.src === "string" && img.src.startsWith("http")) return img.src;
    }
  }

  if (Array.isArray(product.variants) && product.variants.length > 0) {
    for (const v of product.variants) {
      if (typeof v?.image?.url === "string" && v.image.url.startsWith("http")) return v.image.url;
      if (typeof v?.image?.src === "string" && v.image.src.startsWith("http")) return v.image.src;
      if (typeof v?.image === "string" && v.image.startsWith("http")) return v.image;
    }
  }

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

      // SKU-aware re-rank only when the user typed a SKU-like token.
      const userSpecs = extractQuerySpecs(userQuery || "");
      const searchSpecs = extractQuerySpecs(searchQuery || "");
      const skuPatterns = [...new Set([...userSpecs.skuPatterns, ...searchSpecs.skuPatterns])];

      let ranked = mappedProducts;
      if (skuPatterns.length > 0) {
        console.log(`[ToolService] SKU re-rank for: [${skuPatterns.join(", ")}]`);
        ranked = [...mappedProducts].sort((a, b) => {
          const sa = scoreProductBySpecs({ sku: a.sku, title: a.title, variants: a._variants }, { skuPatterns });
          const sb = scoreProductBySpecs({ sku: b.sku, title: b.title, variants: b._variants }, { skuPatterns });
          return sb - sa;
        });
      }

      ranked.forEach((p) => { delete p._variants; });

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
