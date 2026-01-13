// app/services/tool.server.js
/**
 * Tool Service - COMPLETE FIXED VERSION
 * Manages tool execution and product processing
 */

export function createToolService() {
  const MAX_PRODUCTS_TO_DISPLAY = 8;

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
        // Get image URL - try multiple possible fields
        const rawImageUrl =
          p.image_url ||
          p.featuredImage?.url ||
          p.image?.url ||
          (p.images && Array.isArray(p.images.edges) && p.images.edges[0]?.node?.url) ||
          "";

        const fixedImage = fixUrl(rawImageUrl, shopDomain);

        // Get product URL
        const rawProductUrl = p.url || p.onlineStoreUrl || "";
        const fixedProductUrl = fixUrl(rawProductUrl, shopDomain);

        // Generate checkout URL from variant
        let checkoutUrl = "";
        let firstVariant = null;

        if (Array.isArray(p.variants) && p.variants.length > 0) {
          firstVariant = p.variants[0];
        }

        if (firstVariant && firstVariant.id) {
          const variantGid = firstVariant.id;
          let numericVariantId = variantGid;

          const prefix = "gid://shopify/ProductVariant/";
          if (typeof variantGid === "string" && variantGid.startsWith(prefix)) {
            numericVariantId = variantGid.replace(prefix, "");
          }

          checkoutUrl = `https://${shopDomain}/cart/${numericVariantId}:1`;
        }

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
          url: fixedProductUrl || p.url,
          checkout_url: checkoutUrl,
          price: priceText,
          description: p.description || "",
        };
      });

      console.log(`✅ Processed ${fixedProducts.length} products, returning first ${MAX_PRODUCTS_TO_DISPLAY}`);
      
      // Update the tool response content so Claude also sees the fixed URLs
      responseData.products = fixedProducts;
      toolUseResponse.content[0].text = JSON.stringify(responseData);

      // Return products for frontend display
      return fixedProducts.slice(0, MAX_PRODUCTS_TO_DISPLAY);
    } catch (error) {
      console.error("❌ Error processing product search results:", error);
      return [];
    }
  };

  return {
    processProductSearchResult,
  };
}

export default {
  createToolService,
};
