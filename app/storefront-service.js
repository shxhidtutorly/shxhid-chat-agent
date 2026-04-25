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
// ============================================
export async function searchProductsForChat(searchQuery, { first = 50, shopDomain } = {}) {
  if (!searchQuery || typeof searchQuery !== 'string') {
    throw new Error('Search query is required');
  }

  const trimmed = searchQuery.trim();
  console.log(`[StorefrontService:chat] Direct search: "${trimmed.substring(0, 60)}"`);

  const data = await shopifyStorefrontQuery({
    query: SEARCH_PRODUCTS_QUERY,
    variables: { query: trimmed, first },
    shopDomain,
  });

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
