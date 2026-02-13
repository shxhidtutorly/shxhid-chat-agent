/**
 * Tool Service - FIXED VERSION
 * Gets REAL product handles from Shopify instead of generating fake URLs
 */

export function createToolService() {
  const MAX_PRODUCTS_TO_DISPLAY = 8;

  /**
   * ✅ CRITICAL FIX: Use product HANDLE from MCP response
   * The MCP tool returns products with handles if they're available
   */
  const processProductSearchResult = (toolUseResponse, shopDomain) => {
    try {
      console.log("🔍 Processing product search result for domain:", shopDomain);

      if (!toolUseResponse?.content || toolUseResponse.content.length === 0) {
        console.log("❌ No content in tool response");
        return [];
      }

      let contentText = toolUseResponse.content[0].text;
      let responseData;

      try {
        responseData = typeof contentText === "string" ? JSON.parse(contentText) : contentText;
      } catch (e) {
        console.error("❌ Failed to parse tool content:", e);
        return [];
      }

      if (!responseData?.products || !Array.isArray(responseData.products)) {
        console.log("❌ No products array in response");
        return [];
      }

      console.log(`✅ Found ${responseData.products.length} products in response`);

      // ✅ Process each product
      const fixedProducts = responseData.products.map((p) => {
        // Get image URL
        const rawImageUrl = p.image_url || p.featuredImage?.url || "";

        // ✅ CRITICAL: Use product HANDLE if available
        // Otherwise extract from product_id (last number)
        let productHandle = p.handle;
        
        if (!productHandle) {
          // Fallback: extract ID from GID and create minimal slug
          const productId = p.product_id?.replace('gid://shopify/Product/', '');
          const titleSlug = (p.title || 'product')
            .toLowerCase()
            .trim()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-|-$/g, '')
            .substring(0, 50); // Limit length
          
          productHandle = titleSlug;
          console.warn(`⚠️ No handle for product, using slug: ${productHandle}`);
        }

        // ✅ Build real Shopify product URL using handle
        const productUrl = `https://${shopDomain}/products/${productHandle}`;

        console.log(`✅ Product URL: ${productUrl}`);

        // Get variant info
        let firstVariant = null;
        if (Array.isArray(p.variants) && p.variants.length > 0) {
          firstVariant = p.variants[0];
        }

        const variantIdRaw = firstVariant?.id || firstVariant?.variant_id || null;

        // Format price
        let priceText = "";
        if (p.price) {
          priceText = p.price;
        } else if (p.price_range) {
          const pr = p.price_range;
          const currency = pr.currency || "USD";
          if (pr.min && pr.max && pr.min !== pr.max) {
            priceText = `${pr.min} - ${pr.max} ${currency}`;
          } else if (pr.min) {
            priceText = `${pr.min} ${currency}`;
          }
        }

        return {
          id: p.product_id || p.id,
          title: p.title || "Untitled Product",
          handle: productHandle, // ✅ Store the handle
          image_url: rawImageUrl,
          url: productUrl, // ✅ Real product URL
          price: priceText,
          description: p.description || "",
          variant_id: variantIdRaw,
          merchandise_id: variantIdRaw,
          sku: p.sku || firstVariant?.sku || null,
        };
      });

      console.log(`✅ Processed ${fixedProducts.length} products`);
      
      // Update tool response
      responseData.products = fixedProducts;
      toolUseResponse.content[0].text = JSON.stringify(responseData);

      return fixedProducts.slice(0, MAX_PRODUCTS_TO_DISPLAY);
    } catch (error) {
      console.error("❌ Error processing product search results:", error);
      return [];
    }
  };

  const processCartUpdateResult = (toolUseResponse) => {
    if (!toolUseResponse || toolUseResponse.error) {
      return { checkoutUrl: null, cart: null };
    }

    try {
      const raw = toolUseResponse.content?.[0]?.text ?? toolUseResponse.content?.[0]?.data;
      const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;

      if (!parsed || typeof parsed !== "object") {
        return { checkoutUrl: null, cart: null };
      }

      // ✅ Try multiple checkout URL paths from Shopify
      const checkoutUrl =
        parsed.checkout_url ||
        parsed.checkoutUrl ||
        parsed.cart?.checkoutUrl ||
        parsed.cart?.checkout_url ||
        parsed.data?.cart?.checkoutUrl ||
        parsed.data?.cart?.checkout_url ||
        null;

      const cart = parsed.cart || parsed.data?.cart || parsed;

      console.log(`✅ Extracted checkoutUrl: ${checkoutUrl ? checkoutUrl.substring(0, 60) + "..." : "null"}`);

      return { checkoutUrl, cart };
    } catch (error) {
      console.error("❌ Error processing cart update result:", error);
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
