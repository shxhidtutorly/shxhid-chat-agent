/**
 * Search Router
 *
 * Runs BEFORE the Claude/MCP loop. Inspects the user's message:
 *   - SKU            → Admin productVariants(query: "sku:...") via admin-products
 *   - BRAND_ONLY     → Admin products(query: 'vendor:"X"')
 *   - BRAND_PLUS_*   → Admin products(query: 'vendor:"X" AND (title:Y OR product_type:Y)')
 *                       fallback: vendor only
 *   - FREE_TEXT      → returns null (existing MCP flow handles it)
 *
 * Returns products in the SAME shape the frontend expects (matching the
 * tool.server.js processProductSearchResult output shape) so that the
 * existing product card / cart pipeline works unchanged.
 */

import { classifyQuery } from "./query-classifier.server.js";
import { searchProductsByVendor, searchBySku } from "./admin-products.server.js";

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
  const fmt = (p) =>
    `${parseFloat(p.amount).toFixed(2)} ${p.currencyCode || "AED"}`;
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

function adminProductToCardShape(product) {
  const firstVariant = product?.variants?.nodes?.[0] || null;
  const variantId = firstVariant?.id || null;
  return {
    id: product.id,
    title: product.title || "Untitled Product",
    handle: product.handle || null,
    vendor: product.vendor || null,
    image_url: pickImageUrl(product),
    url: product.handle ? productUrlFor(product.handle) : null,
    price: formatPrice(product.priceRangeV2),
    description: plainTextFromHtml(product.descriptionHtml).slice(0, 500),
    variant_id: variantId,
    merchandise_id: variantId,
    sku: firstVariant?.sku || null,
  };
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

export async function smartSearch(userMessage, shopDomain) {
  const classified = classifyQuery(userMessage);
  console.log(`[SearchRouter] classified "${userMessage}" → ${classified.type}${
    classified.brand ? ` brand="${classified.brand}"` : ""
  }${classified.sku ? ` sku="${classified.sku}"` : ""}`);

  if (!shopDomain) {
    console.warn(`[SearchRouter] no shopDomain — skipping admin search`);
    return null;
  }

  switch (classified.type) {
    case "SKU": {
      const result = await searchBySku(shopDomain, classified.sku);
      if (!result || result.type === "none") return null;

      const products = dedupeById(result.variants.map(skuVariantToCardShape));
      if (products.length === 0) return null;

      const hint =
        result.type === "exact"
          ? `Found exact SKU match for "${classified.sku}". Acknowledge briefly and let the user view the product card already shown.`
          : `No exact SKU match for "${classified.sku}". Showing similar products. Tell the user honestly that no exact match was found and these are alternatives.`;

      return {
        products,
        searchType: "sku",
        skuMatch: result.type,
        originalSku: classified.sku,
        systemHint: hint,
      };
    }

    case "BRAND_ONLY": {
      const products = await searchProductsByVendor(shopDomain, classified.brand, "");
      if (!products || products.length === 0) return null;
      return {
        products: products.map(adminProductToCardShape),
        searchType: "vendor",
        brand: classified.brand,
        systemHint: `Found ${products.length} products from vendor "${classified.brand}". Acknowledge briefly — product cards are already displayed.`,
      };
    }

    case "BRAND_PLUS_CATEGORY": {
      let products = await searchProductsByVendor(
        shopDomain,
        classified.brand,
        classified.remainder
      );

      if (!products || products.length === 0) {
        const brandOnly = await searchProductsByVendor(shopDomain, classified.brand, "");
        if (brandOnly && brandOnly.length > 0) {
          return {
            products: brandOnly.map(adminProductToCardShape),
            searchType: "vendor_fallback",
            brand: classified.brand,
            systemHint: `No "${classified.brand} ${classified.remainder}" found specifically. Showing all ${classified.brand} products instead. Tell the user: "I couldn't find ${classified.brand} ${classified.remainder} specifically, but here are other ${classified.brand} products we carry."`,
          };
        }
        return null;
      }

      return {
        products: products.map(adminProductToCardShape),
        searchType: "vendor_category",
        brand: classified.brand,
        systemHint: `Found ${products.length} "${classified.brand}" products matching "${classified.remainder}". Acknowledge briefly.`,
      };
    }

    default:
      return null;
  }
}
