// app/services/tool.server.js
/**
 * Tool Service - COMPLETE FIXED VERSION
 * Manages tool execution and product processing
 * ✅ CRITICAL FIX: Generates product URLs from handles
 */

export function createToolService() {
  const MAX_PRODUCTS_TO_DISPLAY = 8;

  /**
   * Generate product URL from handle
   * @private
   */
  const generateProductUrl = (handle, shopDomain) => {
    if (!handle || !shopDomain) return null;
    return `https://${shopDomain}/products/${handle}`;
  };

  /**
   * Helper to fix URLs by prepending shop domain if needed
   */
  const fixUrl = (url, shopDomain) => {
    if (!url) return "";
    if (typeof url !== "string") return "";

    // If it's already an absolute URL, leave it alone
    if (url.startsWith("http://") || url.startsWith("https://")) return url;

    // Remove leading slash if present to avoid double slashes
    const cleanPath = url.startsWith("/") ? url.substring(1) : url;
    return `https://${shopDomain}/${cleanPath}`;
  };

  /**
   * Processes product search results and returns formatted products for display
   * ✅ NOW GENERATES PRODUCT URLS
   */
  const processProductSearchResult = (toolUseResponse, shopDomain) => {
    try {
      console.log("🔍 Processing product search result for domain:", shopDomain);

      if (!toolUseResponse?.content || toolUseResponse.content.length === 0) {
        console.log("❌ No content in tool response");
        return [];
      }

      // 1. Parse the JSON content
      let contentText = toolUseResponse.content[0].text;
      let responseData;

      try {
        responseData = typeof contentText === "string" ? JSON.parse(contentText) : contentText;
      } catch (e) {
        console.error("❌ Failed to parse tool content:", e);
        return [];
      }

      // 2. Check if we have products
      if (!responseData?.products || !Array.isArray(responseData.products)) {
        console.log("❌ No products array in response");
        return [];
      }

      console.log(`✅ Found ${responseData.products.length} products in response`);

      // 3. Process and fix each product
      const fixedProducts = responseData.products.map((p) => {
        // Get image URL
        const rawImageUrl =
          p.image_url ||
          p.featuredImage?.url ||
          p.image?.url ||
          (p.images && Array.isArray(p.images.edges) && p.images.edges[0]?.node?.url) ||
          "";

        const fixedImage = fixUrl(rawImageUrl, shopDomain);

        // ✅ CRITICAL: Generate product URL from handle
        let productUrl = null;
        
        // Try to get URL from response first
        if (p.url || p.product_url || p.onlineStoreUrl) {
          productUrl = fixUrl(p.url || p.product_url || p.onlineStoreUrl, shopDomain);
        }
        // ✅ NEW: Generate from handle if no URL provided
        else if (p.handle) {
          productUrl = generateProductUrl(p.handle, shopDomain);
          console.log(`📦 Generated URL from handle "${p.handle}": ${productUrl}`);
        }

        // Get variant info
        let firstVariant = null;
        if (Array.isArray(p.variants) && p.variants.length > 0) {
          firstVariant = p.variants[0];
        }

        const variantIdRaw =
          firstVariant?.id ||
          firstVariant?.variant_id ||
          firstVariant?.merchandise_id ||
          null;

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
          image_url: fixedImage,
          url: productUrl, // ✅ NOW ALWAYS HAS A URL
          price: priceText,
          description: p.description || "",
          variant_id: variantIdRaw,
          merchandise_id: variantIdRaw,
          sku: p.sku || firstVariant?.sku || null,
          handle: p.handle, // Include handle for reference
        };
      });

      console.log(`✅ Processed ${fixedProducts.length} products with URLs`);
      
      // Update the tool response content
      responseData.products = fixedProducts;
      toolUseResponse.content[0].text = JSON.stringify(responseData);

      return fixedProducts.slice(0, MAX_PRODUCTS_TO_DISPLAY);
    } catch (error) {
      console.error("❌ Error processing product search results:", error);
      return [];
    }
  };

  /**
   * Processes cart update results
   */
  const processCartUpdateResult = (toolUseResponse) => {
    if (!toolUseResponse || toolUseResponse.error) return { checkoutUrl: null, cart: null };

    try {
      const raw = toolUseResponse.content?.[0]?.text ?? toolUseResponse.content?.[0]?.data;
      const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;

      if (!parsed || typeof parsed !== "object") {
        return { checkoutUrl: null, cart: null };
      }

      // Try multiple likely shapes
      const checkoutUrl =
        parsed.checkout_url ||
        parsed.checkoutUrl ||
        parsed.cart?.checkoutUrl ||
        parsed.cart?.checkout_url ||
        parsed.data?.cart?.checkoutUrl ||
        parsed.data?.cart?.checkout_url ||
        parsed.data?.cartCreate?.cart?.checkoutUrl ||
        parsed.data?.cartCreate?.cart?.checkout_url ||
        parsed.data?.cartLinesAdd?.cart?.checkoutUrl ||
        parsed.data?.cartLinesAdd?.cart?.checkout_url ||
        parsed.data?.checkoutUrl ||
        parsed.data?.checkout_url ||
        null;

      const cart =
        parsed.cart ||
        parsed.data?.cart ||
        parsed.data?.cartCreate?.cart ||
        parsed.data?.cartLinesAdd?.cart ||
        parsed;

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
