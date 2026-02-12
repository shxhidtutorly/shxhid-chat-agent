/**
 * Storefront Service - High-level API for chat agent
 * Handles all product and cart operations
 */

import { shopifyStorefrontQuery } from './shopify-storefront';
import {
  SEARCH_PRODUCTS_QUERY,
  GET_PRODUCT_BY_HANDLE_QUERY,
  CREATE_CART_MUTATION,
  ADD_LINES_TO_CART_MUTATION,
  GET_CART_QUERY
} from './storefront-queries';

const SHOP_DOMAIN = process.env.SHOPIFY_DOMAIN;

// ============================================
// SEARCH PRODUCTS
// ============================================
export async function searchProducts(searchQuery) {
  if (!searchQuery || typeof searchQuery !== 'string') {
    throw new Error('Search query is required');
  }

  console.log(`🔍 Searching for: "${searchQuery}"`);

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
// GET PRODUCT DETAILS
// ============================================
export async function getProductByHandle(handle) {
  if (!handle) throw new Error('Product handle is required');

  console.log(`📦 Fetching product: ${handle}`);

  try {
    const data = await shopifyStorefrontQuery({
      query: GET_PRODUCT_BY_HANDLE_QUERY,
      variables: { handle }
    });

    const product = data.productByHandle;
    if (!product) throw new Error('Product not found');

    return {
      id: product.id,
      title: product.title,
      handle: product.handle,
      description: product.description,
      image_url: product.featuredImage?.url,
      images: product.images?.edges?.map(e => e.node.url) || [],
      variants: product.variants?.edges?.map(e => ({
        id: e.node.id,
        title: e.node.title,
        sku: e.node.sku,
        available: e.node.availableForSale,
        price: e.node.price?.amount,
      })) || [],
      url: `https://${SHOP_DOMAIN}/products/${product.handle}`,
    };

  } catch (error) {
    console.error('❌ Get product failed:', error.message);
    throw error;
  }
}

// ============================================
// ADD TO CART (Create or Update)
// ============================================
export async function addToCart({ variantId, quantity = 1, cartId = null }) {
  if (!variantId) throw new Error('Variant ID is required');

  console.log(`🛒 Adding to cart: ${variantId} (qty: ${quantity}), cartId: ${cartId || 'new'}`);

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
      console.log(`✅ Cart created: ${cart.id}`);

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

// ============================================
// GET CART
// ============================================
export async function getCart(cartId) {
  if (!cartId) throw new Error('Cart ID is required');

  console.log(`🛒 Fetching cart: ${cartId}`);

  try {
    const data = await shopifyStorefrontQuery({
      query: GET_CART_QUERY,
      variables: { cartId }
    });

    const cart = data.cart;
    if (!cart) throw new Error('Cart not found');

    return {
      id: cart.id,
      checkoutUrl: cart.checkoutUrl,
      totalQuantity: cart.totalQuantity,
      items: (cart.lines?.edges || []).map(e => ({
        id: e.node.id,
        quantity: e.node.quantity,
        title: e.node.merchandise?.title,
      })),
      total: cart.cost?.totalAmount?.amount,
      currency: cart.cost?.totalAmount?.currencyCode,
    };

  } catch (error) {
    console.error('❌ Get cart failed:', error.message);
    throw error;
  }
}
