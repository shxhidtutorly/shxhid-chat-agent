/**
 * Storefront Service - High-level API for cart operations
 * Uses Storefront API via shopify-storefront.js
 */

import { shopifyStorefrontQuery } from './shopify-storefront.js';
import {
  SEARCH_PRODUCTS_QUERY,
  CREATE_CART_MUTATION,
  ADD_LINES_TO_CART_MUTATION,
} from './storefront-queries.js';

const SHOP_DOMAIN = process.env.SHOPIFY_STORE_DOMAIN || '';

/**
 * Validate that a variant ID is a proper Shopify GID.
 * Expected format: gid://shopify/ProductVariant/{numeric_id}
 */
function isValidVariantGid(variantId) {
  if (!variantId || typeof variantId !== 'string') return false;
  return /^gid:\/\/shopify\/ProductVariant\/\d+$/.test(variantId);
}

// ============================================
// SEARCH PRODUCTS
// ============================================
export async function searchProducts(searchQuery) {
  if (!searchQuery || typeof searchQuery !== 'string') {
    throw new Error('Search query is required');
  }

  console.log(`[StorefrontService] Search: "${searchQuery.substring(0, 40)}"`);

  try {
    const data = await shopifyStorefrontQuery({
      query: SEARCH_PRODUCTS_QUERY,
      variables: {
        query: searchQuery.trim(),
        first: 10
      }
    });

    const products = (data.products?.edges || []).map(({ node }) => ({
      id: node.id,
      title: node.title,
      handle: node.handle,
      description: node.description,
      image_url: node.featuredImage?.url,
      price: node.priceRange.minVariantPrice.amount,
      currency: node.priceRange.minVariantPrice.currencyCode,
      url: node.handle ? `https://${SHOP_DOMAIN}/products/${node.handle}` : null,
      variant_id: node.variants.edges[0]?.node.id,
      available: node.variants.edges[0]?.node.availableForSale || false,
    }));

    if (!products.length) console.warn('[StorefrontService] No products found');
    return products;

  } catch (error) {
    console.error('[StorefrontService] Search failed:', error.message);
    throw error;
  }
}

// ============================================
// CHAT-COMPATIBLE SEARCH (used as fallback when MCP search is unreliable)
//
// Returns results wrapped in the same shape as a Storefront MCP tool response,
// so chat.jsx can hand them straight to processProductSearchResult() in
// app/services/tool.server.js without any per-source branching.
//
// WHY: Production observation (April 2026) — Shopify's storefront MCP
// `search_catalog` started returning a near-fixed set of unrelated products
// (the same Delta inverter drives) regardless of the query for shops with
// large catalogs (100k+ products). The native Storefront API
// `products(query:)` field is a separate, reliable index used by the
// storefront search bar itself; falling back to it recovers correct results.
//
// SKU-FIRST SEARCH (April 2026):
// For shops with 100k+ B2B SKUs, partial-SKU lookups must be reliable.
// Shopify Storefront API supports field-targeted search syntax —
// `sku:*ABC123*` matches the variant SKU field directly, which is far more
// precise than freetext when the user types a model number.
// We detect SKU-like tokens in the query and prefix the search with a
// targeted `sku:* OR title:* OR vendor:*` clause. Falls back to plain
// freetext if the targeted query returns nothing.
// Search syntax reference: https://shopify.dev/docs/api/usage/search-syntax
// ============================================

// SKU-like tokens: alphanumeric with at least one digit and a dash/dot/slash
// or of length >= 5. Examples:
//   "3NA7836"      → SKU-like
//   "6SL3220-1YE34-0UF0" → SKU-like
//   "ACS580"       → SKU-like (5+ alphanumeric with digit)
//   "AODD"         → NOT SKU-like (no digits)
//   "Schneider"    → NOT SKU-like (no digits)
function extractSkuLikeTokens(query) {
  if (!query || typeof query !== 'string') return [];
  const tokens = query.split(/\s+/).filter(Boolean);
  const out = [];
  for (const raw of tokens) {
    const t = raw.replace(/[,;:!?()]+$/g, '').replace(/^[,;:!?()]+/g, '');
    if (t.length < 4) continue;
    if (!/\d/.test(t)) continue; // SKUs almost always contain digits
    if (!/^[A-Za-z0-9][A-Za-z0-9\-\.\/]*$/.test(t)) continue;
    if (t.length < 5 && !/[\-\.\/]/.test(t)) continue;
    out.push(t);
  }
  return out;
}

// Escape Shopify search-syntax special characters in a value passed inside
// `field:*VALUE*`. Shopify treats `* ( ) "` etc. as syntax — we keep `*` for
// wildcards we add ourselves and escape the rest.
function escapeSearchValue(v) {
  return String(v || '').replace(/["()\\:]/g, ' ').trim();
}

/**
 * Build a Shopify Storefront search query string. When the user query contains
 * SKU-like tokens, target them at the SKU/title/vendor fields with wildcards.
 * Otherwise use plain freetext (Shopify's default cross-field search).
 */
function buildStorefrontQueryString(rawQuery) {
  const trimmed = String(rawQuery || '').trim();
  const skuTokens = extractSkuLikeTokens(trimmed);
  if (skuTokens.length === 0) {
    return trimmed; // freetext
  }
  const clauses = skuTokens.map((tok) => {
    const safe = escapeSearchValue(tok);
    if (!safe) return null;
    return `(sku:*${safe}* OR title:*${safe}* OR vendor:*${safe}*)`;
  }).filter(Boolean);
  return clauses.join(' AND ');
}

export async function searchProductsForChat(searchQuery, { first = 50, shopDomain } = {}) {
  if (!searchQuery || typeof searchQuery !== 'string') {
    throw new Error('Search query is required');
  }

  const trimmed = searchQuery.trim();
  const targetedQuery = buildStorefrontQueryString(trimmed);
  const isSkuTargeted = targetedQuery !== trimmed;

  if (isSkuTargeted) {
    console.log(`[StorefrontService:chat] SKU-targeted search: "${trimmed}" → "${targetedQuery}"`);
  } else {
    console.log(`[StorefrontService:chat] Direct search: "${trimmed.substring(0, 60)}"`);
  }

  let data = await shopifyStorefrontQuery({
    query: SEARCH_PRODUCTS_QUERY,
    variables: { query: targetedQuery, first },
    shopDomain,
  });

  // If SKU-targeted query returned nothing, fall back to plain freetext —
  // SKU may live in tags/description/handle rather than variant.sku.
  if (isSkuTargeted && (data?.products?.edges?.length || 0) === 0) {
    console.log(`[StorefrontService:chat] SKU-targeted query returned 0 — retrying as freetext`);
    data = await shopifyStorefrontQuery({
      query: SEARCH_PRODUCTS_QUERY,
      variables: { query: trimmed, first },
      shopDomain,
    });
  }

  const edges = data?.products?.edges || [];
  const products = edges.map(({ node }) => {
    // Shape mirrors what the MCP catalog tool returns so processProductSearchResult
    // (and its formatPrice / buildProductSearchText helpers) work unchanged.
    const variants = (node.variants?.edges || []).map(({ node: v }) => ({
      id: v.id,
      title: v.title,
      sku: v.sku,
      available: v.availableForSale,
      price: v.price, // { amount, currencyCode } — formatPrice handles this
    }));

    return {
      id: node.id,
      product_id: node.id,
      title: node.title,
      handle: node.handle,
      description: node.description,
      vendor: node.vendor,
      product_type: node.productType,
      tags: node.tags,
      image_url: node.featuredImage?.url || '',
      featuredImage: node.featuredImage,
      priceRange: node.priceRange, // { minVariantPrice, maxVariantPrice }
      variants,
      sku: variants[0]?.sku || null,
    };
  });

  console.log(`[StorefrontService:chat] Direct API returned ${products.length} products for "${trimmed.substring(0, 40)}"`);

  // Wrap in the MCP tool response shape that processProductSearchResult expects.
  return {
    content: [{
      type: 'text',
      text: JSON.stringify({ products }),
    }],
  };
}

// ============================================
// ADD TO CART
// ============================================
export async function addToCart({ variantId, quantity = 1, cartId = null }) {
  if (!variantId) {
    throw new Error('Variant ID is required');
  }

  // Validate GID format
  if (!isValidVariantGid(variantId)) {
    console.error(
      `[StorefrontService] Invalid variant GID: "${variantId}". ` +
      'Expected format: gid://shopify/ProductVariant/{id}'
    );
    throw new Error(
      `Invalid variant ID format. Expected Shopify GID (gid://shopify/ProductVariant/...), got: ${variantId.substring(0, 60)}`
    );
  }

  console.log(`[StorefrontService] Add to cart: qty=${quantity} cart=${cartId ? 'existing' : 'new'}`);

  try {
    const lines = [{
      merchandiseId: variantId,
      quantity: parseInt(quantity)
    }];

    let result;

    if (!cartId) {
      result = await shopifyStorefrontQuery({
        query: CREATE_CART_MUTATION,
        variables: { lines }
      });

      const errors = result.cartCreate?.userErrors;
      if (errors?.length) {
        console.error('[StorefrontService] cartCreate userErrors:', errors);
        throw new Error(errors[0].message);
      }

      const cart = result.cartCreate.cart;
      console.log('[StorefrontService] Cart created');

      return {
        status: 'success',
        cartId: cart.id,
        checkoutUrl: cart.checkoutUrl,
        totalQuantity: cart.totalQuantity,
      };

    } else {
      result = await shopifyStorefrontQuery({
        query: ADD_LINES_TO_CART_MUTATION,
        variables: { cartId, lines }
      });

      const errors = result.cartLinesAdd?.userErrors;
      if (errors?.length) {
        console.error('[StorefrontService] cartLinesAdd userErrors:', errors);
        throw new Error(errors[0].message);
      }

      const cart = result.cartLinesAdd.cart;
      console.log('[StorefrontService] Item added to cart');

      return {
        status: 'success',
        cartId: cart.id,
        checkoutUrl: cart.checkoutUrl,
        totalQuantity: cart.totalQuantity,
      };
    }

  } catch (error) {
    console.error('[StorefrontService] Add to cart failed:', error.message);
    throw error;
  }
}
