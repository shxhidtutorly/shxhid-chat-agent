/**
 * Tool Service
 * Processes MCP tool responses (product search, cart updates)
 */

export function createToolService() {
  const MAX_PRODUCTS_TO_DISPLAY = 8;

  /**
   * Resolve a product URL safely.
   *
   * Order of preference:
   *   1. Use `handle` from MCP response → build /products/{handle}
   *   2. Extract handle from a canonical URL containing /products/
   *   3. Use the full product_url or url directly (no modification)
   *   4. null — frontend should disable the "View" button
   *
   * NEVER fabricate a slug from the product title.
   */
  function resolveProductUrl(product, shopDomain) {
    // 1. Explicit handle from MCP
    if (product.handle) {
      return `https://${shopDomain}/products/${product.handle}`;
    }

    // 2. Try to extract handle from an existing canonical URL
    const rawUrl = product.product_url || product.url || '';
    if (rawUrl) {
      const productsMatch = rawUrl.match(/\/products\/([a-z0-9][a-z0-9\-]*)/i);
      if (productsMatch && productsMatch[1]) {
        return `https://${shopDomain}/products/${productsMatch[1]}`;
      }
      // 3. Has a URL but not a /products/ path — use it as-is
      if (rawUrl.startsWith('http')) {
        return rawUrl;
      }
    }

    // 4. No reliable URL source
    console.warn(
      `[ToolService] Product "${product.title}" (${product.product_id || product.id}) ` +
      'has no handle or canonical URL. View button will be disabled.'
    );
    return null;
  }

  /**
   * Process product search results from MCP tool response.
   * Preserves product_id, variant_id, and builds safe URLs.
   */
  const processProductSearchResult = (toolUseResponse, shopDomain) => {
    try {
      if (!toolUseResponse?.content || toolUseResponse.content.length === 0) {
        console.log('[ToolService] No content in tool response');
        return [];
      }

      let contentText = toolUseResponse.content[0].text;
      let responseData;

      try {
        responseData = typeof contentText === 'string' ? JSON.parse(contentText) : contentText;
      } catch (e) {
        console.error('[ToolService] Failed to parse tool content:', e.message);
        return [];
      }

      if (!responseData?.products || !Array.isArray(responseData.products)) {
        console.log('[ToolService] No products array in response data:', Object.keys(responseData || {}));
        return [];
      }

      const resultCount = responseData.products.length;
      console.log(`[ToolService] Search returned ${resultCount} products for ${shopDomain}`);

      const fixedProducts = responseData.products.map((p) => {
        const rawImageUrl = p.image_url || p.featuredImage?.url || '';
        const productUrl = resolveProductUrl(p, shopDomain);

        // Extract variant info
        let firstVariant = null;
        if (Array.isArray(p.variants) && p.variants.length > 0) {
          firstVariant = p.variants[0];
        }
        const variantIdRaw = firstVariant?.id || firstVariant?.variant_id || null;

        // Format price
        let priceText = '';
        if (p.price) {
          priceText = p.price;
        } else if (p.price_range) {
          const pr = p.price_range;
          const currency = pr.currency || 'USD';
          if (pr.min && pr.max && pr.min !== pr.max) {
            priceText = `${pr.min} - ${pr.max} ${currency}`;
          } else if (pr.min) {
            priceText = `${pr.min} ${currency}`;
          }
        }

        return {
          id: p.product_id || p.id,
          title: p.title || 'Untitled Product',
          handle: p.handle || null,
          image_url: rawImageUrl,
          url: productUrl,
          price: priceText,
          description: p.description || '',
          variant_id: variantIdRaw,
          merchandise_id: variantIdRaw,
          sku: p.sku || firstVariant?.sku || null,
        };
      });

      console.log(`[ToolService] Processed ${fixedProducts.length} products`);

      // Update tool response content so Claude sees the processed data
      responseData.products = fixedProducts;
      toolUseResponse.content[0].text = JSON.stringify(responseData);

      return fixedProducts.slice(0, MAX_PRODUCTS_TO_DISPLAY);
    } catch (error) {
      console.error('[ToolService] Error processing product search results:', error);
      return [];
    }
  };

  const processCartUpdateResult = (toolUseResponse) => {
    if (!toolUseResponse || toolUseResponse.error) {
      return { checkoutUrl: null, cart: null };
    }

    try {
      const raw = toolUseResponse.content?.[0]?.text ?? toolUseResponse.content?.[0]?.data;
      const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;

      if (!parsed || typeof parsed !== 'object') {
        return { checkoutUrl: null, cart: null };
      }

      const checkoutUrl =
        parsed.checkout_url ||
        parsed.checkoutUrl ||
        parsed.cart?.checkoutUrl ||
        parsed.cart?.checkout_url ||
        parsed.data?.cart?.checkoutUrl ||
        parsed.data?.cart?.checkout_url ||
        null;

      const cart = parsed.cart || parsed.data?.cart || parsed;

      if (checkoutUrl) {
        console.log(`[ToolService] Checkout URL: ${checkoutUrl.substring(0, 60)}...`);
      } else {
        console.warn('[ToolService] No checkout URL found in cart update response');
      }

      return { checkoutUrl, cart };
    } catch (error) {
      console.error('[ToolService] Error processing cart update result:', error);
      return { checkoutUrl: null, cart: null };
    }
  };

  return {
    processProductSearchResult,
    processCartUpdateResult,
  };
}

export default {
  createToolService,
};
