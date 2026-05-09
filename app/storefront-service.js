/**
 * Storefront Service — High-level API for cart operations and chat search
 *
 * PATCH v3.0 — April 2026
 *
 * KEY CHANGES:
 *
 * 1. searchProductsForChat() now uses STOREFRONT_SEARCH_QUERY (the `search`
 *    field) instead of SEARCH_PRODUCTS_QUERY (the `products` field).
 *    The `search` field indexes variant.sku; `products` does not.
 *    Verified against Shopify docs: shopify.dev/docs/api/storefront/2025-01/queries/search
 *
 * 2. Removed buildStorefrontQueryString() entirely. It generated
 *    `sku:*VALUE*` clauses which are NOT valid filters on the Storefront
 *    `products(query:)` connection. The only valid filters there are:
 *    title, product_type, vendor, tag, variants.price, available_for_sale.
 *    Source: shopify.dev/docs/api/storefront/2025-01/queries/products
 *    The `search` query natively handles SKU lookup without field prefixes.
 *
 * 3. Response parsing updated for the search query shape:
 *    data.search.edges[].node  (not data.products.edges[].node)
 */

import { shopifyStorefrontQuery, shopifyAdminGraphqlQuery } from './shopify-storefront.js';
import {
  STOREFRONT_PLAIN_SEARCH_QUERY,
  STOREFRONT_SEARCH_QUERY,
  SEARCH_PRODUCTS_QUERY,
  SEARCH_VARIANT_BY_SKU_QUERY,
  CREATE_CART_MUTATION,
  ADD_LINES_TO_CART_MUTATION,
} from './storefront-queries.js';

// Industrial brands carried by Creative Automation. When the chat search
// is a single brand token, we promote it to a vendor-targeted query string
// so the Storefront index returns brand-coherent results.
const KNOWN_BRAND_SET = new Set([
  'abb','siemens','schneider','phoenix','rockwell','allen-bradley','omron',
  'smc','festo','mitsubishi','eaton','hager','legrand','ifm','sick','turck',
  'balluff','wago','weidmuller','murr','beckhoff','lapp','pilz','banner',
  'telemecanique','honeywell',
]);

const SHOP_DOMAIN = process.env.SHOPIFY_STORE_DOMAIN || '';

/**
 * Validate that a variant ID is a proper Shopify GID.
 */
function isValidVariantGid(variantId) {
  if (!variantId || typeof variantId !== 'string') return false;
  return /^gid:\/\/shopify\/ProductVariant\/\d+$/.test(variantId);
}

// ============================================
// SEARCH PRODUCTS (used by api.cart.jsx)
// Uses products(query:) — fine for title/handle lookups
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
// CHAT-COMPATIBLE SEARCH (primary fallback when MCP returns unrelated results)
//
// Uses the Storefront `search` query which:
//   1. Indexes variant.sku — essential for B2B SKU lookups
//   2. Supports `prefix: LAST` — matches "MGPM12" → "MGPM12-10Z"
//   3. Uses the same index as the storefront search bar
//
// Returns results in MCP tool response shape so processProductSearchResult()
// in tool.server.js can process them without branching.
// ============================================

/**
 * Build a clean, plain-text search query for the `search` field.
 *
 * The `search` field does NOT use Shopify's field-targeted syntax
 * (title:, sku:, vendor:) — it's a full-text search that automatically
 * searches across all indexed fields including variant.sku.
 *
 * We deliberately use plain freetext — no `sku:*value*` syntax —
 * because `sku:` is only valid on the Admin API's `productVariants`
 * query, NOT the Storefront API's `products` or `search` queries.
 *
 * For SKU-like tokens, the search engine naturally finds products
 * whose variant.sku contains that token. With `prefix: LAST` in the
 * GraphQL query, even partial SKU strings match.
 */
function buildSearchQueryString(rawQuery) {
  if (!rawQuery || typeof rawQuery !== 'string') return '';
  const trimmed = rawQuery.trim();
  if (!trimmed) return '';

  // v4.1: Brand-targeted boost. Single-token query that matches a known brand
  // → expand to vendor:BRAND OR title:BRAND OR tag:BRAND. This keeps Storefront
  // search relevance focused on actual brand inventory rather than text matches.
  const tokens = trimmed.split(/\s+/);
  if (tokens.length === 1) {
    const lower = tokens[0].toLowerCase();
    if (KNOWN_BRAND_SET.has(lower)) {
      const v = tokens[0];
      return `vendor:${v} OR title:${v} OR tag:${v}`;
    }
  }
  return trimmed;
}

/**
 * v4.1: Exact SKU lookup via Admin API productVariants(query: "sku:VALUE").
 *
 * Returns an MCP-shaped tool response so processProductSearchResult() can
 * process it without branching. Filters to exact-equality SKU matches to
 * dodge the Admin API's known sku-substring bug.
 */
export async function searchVariantBySku(sku, { first = 5, shopDomain } = {}) {
  if (!sku || typeof sku !== 'string') {
    throw new Error('SKU is required');
  }
  const cleaned = sku.trim();
  if (!cleaned) throw new Error('SKU is empty');

  console.log(`[StorefrontService:sku] Admin productVariants lookup: "${cleaned}"`);

  let data;
  try {
    data = await shopifyAdminGraphqlQuery({
      query: SEARCH_VARIANT_BY_SKU_QUERY,
      variables: { query: `sku:${cleaned}`, first },
      shopDomain,
    });
  } catch (err) {
    console.warn(`[StorefrontService:sku] Admin lookup failed: ${err.message}`);
    return { content: [{ type: 'text', text: JSON.stringify({ products: [] }) }] };
  }

  const edges = data?.productVariants?.edges || [];
  if (edges.length === 0) {
    console.log(`[StorefrontService:sku] No variant matches for "${cleaned}"`);
    return { content: [{ type: 'text', text: JSON.stringify({ products: [] }) }] };
  }

  // Post-filter: prefer exact-equality matches (Admin sku: query has known
  // substring bug). If no exact, fall back to all matches.
  const skuUpper = cleaned.toUpperCase();
  const exact = edges.filter((e) => String(e.node.sku || '').toUpperCase() === skuUpper);
  const used = exact.length > 0 ? exact : edges;
  if (exact.length === 0 && edges.length > 0) {
    console.log(`[StorefrontService:sku] No exact match — using ${edges.length} substring match(es)`);
  }

  // Group variants by parent product (so we don't return the same product twice)
  const byProduct = new Map();
  for (const { node: variant } of used) {
    const product = variant.product;
    if (!product) continue;
    if (!byProduct.has(product.id)) byProduct.set(product.id, { product, variants: [] });
    byProduct.get(product.id).variants.push(variant);
  }

  const products = [];
  for (const { product, variants } of byProduct.values()) {
    products.push({
      id: product.id,
      product_id: product.id,
      title: product.title,
      handle: product.handle,
      description: product.description,
      vendor: product.vendor,
      product_type: product.productType,
      tags: product.tags,
      image_url: product.featuredImage?.url || '',
      featuredImage: product.featuredImage,
      priceRange: product.priceRange,
      variants: variants.map((v) => ({
        id: v.id,
        title: v.title,
        sku: v.sku,
        available: v.availableForSale,
        price: v.price, // Admin returns string amount; tool.server.formatPrice handles it
      })),
      sku: variants[0]?.sku || null,
    });
  }

  console.log(`[StorefrontService:sku] Returning ${products.length} product(s) for SKU "${cleaned}"`);
  return { content: [{ type: 'text', text: JSON.stringify({ products }) }] };
}

/**
 * Plain-text Storefront search — v5.0
 *
 * Calls Storefront `search(query: ..., types: PRODUCT, prefix: LAST)` with the
 * user's raw text. NO productFilters, NO `vendor:` prefixes, NO query DSL.
 * Shopify's search engine indexes title, description, vendor, productType,
 * tags, and variant.sku — and ranks results by relevance.
 *
 * Docs: https://shopify.dev/docs/api/storefront/latest/queries/search
 *
 * Returns { products, totalCount } in a clean shape that the frontend card
 * renderer expects, or null when no results.
 */
export async function searchWithStorefront(query, { first = 20, shopDomain } = {}) {
  if (!query || typeof query !== 'string') return null;
  const trimmed = query.trim();
  if (!trimmed) return null;

  console.log(`[StorefrontSearch] query="${trimmed}" first=${first}`);

  let data;
  try {
    data = await shopifyStorefrontQuery({
      query: STOREFRONT_PLAIN_SEARCH_QUERY,
      variables: { query: trimmed, first },
      shopDomain,
    });
  } catch (err) {
    console.warn(`[StorefrontSearch] query failed: ${err.message}`);
    return null;
  }

  const nodes = data?.search?.nodes || [];
  const totalCount = data?.search?.totalCount || 0;
  console.log(`[StorefrontSearch] returned ${nodes.length} products (total: ${totalCount})`);

  if (nodes.length === 0) return null;

  const products = nodes.map((node) => {
    const variants = (node.variants?.edges || []).map(({ node: v }) => ({
      id: v.id,
      title: v.title,
      sku: v.sku,
      available: v.availableForSale,
      price: v.price,
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
      priceRange: node.priceRange,
      variants,
      sku: variants[0]?.sku || null,
    };
  });

  return { products, totalCount };
}

/**
 * Detect if a query string looks like a SKU (alphanumeric + at least one digit
 * + at least one letter, length ≥4, no spaces). Used by chat.jsx to decide
 * whether to attempt searchVariantBySku() before generic search.
 */
export function looksLikeSku(query) {
  if (!query || typeof query !== 'string') return false;
  const t = query.trim();
  if (!t || /\s/.test(t)) return false;
  if (t.length < 4) return false;
  if (!/[A-Za-z]/.test(t) || !/\d/.test(t)) return false;
  if (!/^[A-Za-z0-9._\-/]+$/.test(t)) return false;
  return true;
}

export async function searchProductsForChat(searchQuery, { first = 50, shopDomain } = {}) {
  if (!searchQuery || typeof searchQuery !== 'string') {
    throw new Error('Search query is required');
  }

  const trimmed = searchQuery.trim();
  const queryString = buildSearchQueryString(trimmed);

  console.log(`[StorefrontService:chat] Search query: "${queryString.substring(0, 80)}"`);

  const data = await shopifyStorefrontQuery({
    query: STOREFRONT_SEARCH_QUERY,
    variables: { query: queryString, first },
    shopDomain,
  });

  const edges = data?.search?.edges || [];

  if (edges.length === 0) {
    console.log(`[StorefrontService:chat] search() returned 0 results for "${trimmed.substring(0, 60)}"`);
  }

  const products = edges.map(({ node }) => {
    // node is a Product (we specified types: PRODUCT in the query)
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

  console.log(`[StorefrontService:chat] search() returned ${products.length} products for "${trimmed.substring(0, 40)}"`);

  // Wrap in MCP tool response shape that processProductSearchResult expects
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
