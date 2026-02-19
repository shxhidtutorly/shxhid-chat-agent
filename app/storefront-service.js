/**
 * Storefront Service - High-level API for chat agent
 * Handles all product and cart operations
 */

import { shopifyStorefrontQuery } from './shopify-storefront.js';
import {
  SEARCH_PRODUCTS_QUERY,
  CREATE_CART_MUTATION,
  ADD_LINES_TO_CART_MUTATION,
} from './storefront-queries.js';

const SHOP_DOMAIN = process.env.SHOPIFY_STORE_DOMAIN || '';

// ============================================
// SEARCH PRODUCTS
// ============================================
export async function searchProducts(searchQuery) {
  if (!searchQuery || typeof searchQuery !== 'string') {
    throw new Error('Search query is required');
  }

  console.log(`🔍 Searching: "${searchQuery}"`);

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
      url: `https://${SHOP_DOMAIN}/products/${node.handle}`,
      variant_id: node.variants.edges[0]?.node.id,
      available: node.variants.edges[0]?.node.availableForSale || false,
    }));

    console.log(`✅ Found ${products.length} products`);
    return products;

  } catch (error) {
    console.error('❌ Search failed:', error.message);
    throw error;
  }
}

// ============================================
// ADD TO CART
// ============================================
export async function addToCart({ variantId, quantity = 1, cartId = null }) {
  if (!variantId) throw new Error('Variant ID is required');

  console.log(`🛒 Adding to cart: ${variantId} (qty: ${quantity})`);

  try {
    const lines = [{
      merchandiseId: variantId,
      quantity: parseInt(quantity)
    }];

    let result;

    if (!cartId) {
      // Create new cart
      result = await shopifyStorefrontQuery({
        query: CREATE_CART_MUTATION,
        variables: { lines }
      });

      const errors = result.cartCreate?.userErrors;
      if (errors?.length) {
        throw new Error(errors[0].message);
      }

      const cart = result.cartCreate.cart;
      console.log(`✅ Cart created`);

      return {
        status: 'success',
        cartId: cart.id,
        checkoutUrl: cart.checkoutUrl,
        totalQuantity: cart.totalQuantity,
      };

    } else {
      // Add to existing cart
      result = await shopifyStorefrontQuery({
        query: ADD_LINES_TO_CART_MUTATION,
        variables: { cartId, lines }
      });

      const errors = result.cartLinesAdd?.userErrors;
      if (errors?.length) {
        throw new Error(errors[0].message);
      }

      const cart = result.cartLinesAdd.cart;
      console.log(`✅ Item added to cart`);

      return {
        status: 'success',
        cartId: cart.id,
        checkoutUrl: cart.checkoutUrl,
        totalQuantity: cart.totalQuantity,
      };
    }

  } catch (error) {
    console.error('❌ Add to cart failed:', error.message);
    throw error;
  }
}
