/**
 * Storefront Service — High-level API for cart operations and chat search
 *
 * PATCH v3.1 — May 2026
 *
 * KEY CHANGES:
 *
 * 1. searchWithStorefront() — reduced default `first` from 20 to 10.
 *    Sending 20 product cards overwhelms the chat UI. 10 is sufficient.
 *
 * PREVIOUS CHANGES (v3.0 — April 2026):
 * 1. searchProductsForChat() now uses STOREFRONT_SEARCH_QUERY (the `search`
 *    field) instead of SEARCH_PRODUCTS_QUERY (the `products` field).
 * 2. Removed buildStorefrontQueryString() entirely (invalid field syntax).
 * 3. Response parsing updated for the search query shape.
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

const KNOWN_BRAND_SET = new Set([
  'abb','siemens','schneider','phoenix','rockwell','allen-bradley','omron',
  'smc','festo','mitsubishi','eaton','hager','legrand','ifm','sick','turck',
  'balluff','wago','weidmuller','murr','beckhoff','lapp','pilz','banner',
  'telemecanique','honeywell',
]);

const SHOP_DOMAIN = process.env.SHOPIFY_STORE_DOMAIN || '';

function isValidVariantGid(variantId) {
  if (!variantId || typeof variantId !== 'string') return false;
  return /^gid:\/\/shopify\/ProductVariant\/\d+$/.test(variantId);
}

// ============================================
// SEARCH PRODUCTS (used by api.cart.jsx)
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
// SKU LOOKUP via Admin API
// ============================================
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

  const skuUpper = cleaned.toUpperCase();
  const exact = edges.filter((e) => String(e.node.sku || '').toUpperCase() === skuUpper);
  const used = exact.length > 0 ? exact : edges;
  if (exact.length === 0 && edges.length > 0) {
    console.log(`[StorefrontService:sku] No exact match — using ${edges.length} substring match(es)`);
  }

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
        price: v.price,
      })),
      sku: variants[0]?.sku || null,
    });
  }

  console.log(`[StorefrontService:sku] Returning ${products.length} product(s) for SKU "${cleaned}"`);
  return { content: [{ type: 'text', text: JSON.stringify({ products }) }] };
}

/**
 * Plain-text Storefront search — v5.1
 *
 * Calls Storefront `search(query: ..., types: PRODUCT, prefix: LAST)` with the
 * user's raw text. NO productFilters, NO `vendor:` prefixes, NO query DSL.
 *
 * v3.1 change: `first` default reduced from 20 → 10.
 *
 * Returns { products, totalCount } in a clean shape that the frontend card
 * renderer expects, or null when no results.
 */
export async function searchWithStorefront(query, { first = 10, shopDomain } = {}) {
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

export function looksLikeSku(query) {
  if (!query || typeof query !== 'string') return false;
  const t = query.trim();
  if (!t || /\s/.test(t)) return false;
  if (t.length < 4) return false;
  if (!/[A-Za-z]/.test(t) || !/\d/.test(t)) return false;
  if (!/^[A-Za-z0-9._\-/]+$/.test(t)) return false;
  return true;
}

export async function searchProductsForChat(searchQuery, { first = 10, shopDomain } = {}) {
  if (!searchQuery || typeof searchQuery !== 'string') {
    throw new Error('Search query is required');
  }

  const trimmed = searchQuery.trim();

  console.log(`[StorefrontService:chat] Search query: "${trimmed.substring(0, 80)}"`);

  const data = await shopifyStorefrontQuery({
    query: STOREFRONT_SEARCH_QUERY,
    variables: { query: trimmed, first },
    shopDomain,
  });

  const edges = data?.search?.edges || [];

  if (edges.length === 0) {
    console.log(`[StorefrontService:chat] search() returned 0 results for "${trimmed.substring(0, 60)}"`);
  }

  const products = edges.map(({ node }) => {
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

  console.log(`[StorefrontService:chat] search() returned ${products.length} products for "${trimmed.substring(0, 40)}"`);

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
