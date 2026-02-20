/**
 * Storefront Service - High-level API for chat agent
 * Handles all product and cart operations
 *
 * FIX: SHOP_DOMAIN is NO LONGER a module-level const.
 * It is read from process.env at call time to avoid stale baking.
 */
import { shopifyStorefrontQuery } from './shopify-storefront.js';
import {
    SEARCH_PRODUCTS_QUERY,
    CREATE_CART_MUTATION,
    ADD_LINES_TO_CART_MUTATION,
} from './storefront-queries.js';

// ============================================
// SEARCH PRODUCTS
// ============================================
export async function searchProducts(searchQuery) {
    if (!searchQuery || typeof searchQuery !== 'string') {
          throw new Error('Search query is required');
    }

  // Read at call time - never freeze at module load
  const SHOP_DOMAIN = process.env.SHOPIFY_STORE_DOMAIN || '';

  console.log(`\uD83D\uDD0D Searching: "${searchQuery}"`);

  try {
        const data = await shopifyStorefrontQuery({
                query: SEARCH_PRODUCTS_QUERY,
                variables: { query: searchQuery.trim(), first: 10 }
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

      console.log(`\u2705 Found ${products.length} products`);
        return products;
  } catch (error) {
        console.error('\u274C Search failed:', error.message);
        throw error;
  }
}

// ============================================
// ADD TO CART
// ============================================
export async function addToCart({ variantId, quantity = 1, cartId = null }) {
    if (!variantId) throw new Error('Variant ID is required');

  console.log(`\uD83D\uDED2 Adding to cart: ${variantId} (qty: ${quantity})`);

  try {
        const lines = [{ merchandiseId: variantId, quantity: parseInt(quantity) }];
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
              console.log(`\u2705 Cart created`);
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
              console.log(`\u2705 Item added to cart`);
              return {
                        status: 'success',
                        cartId: cart.id,
                        checkoutUrl: cart.checkoutUrl,
                        totalQuantity: cart.totalQuantity,
              };
      }
  } catch (error) {
        console.error('\u274C Add to cart failed:', error.message);
        throw error;
  }
}
