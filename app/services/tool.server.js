// app/services/tool.server.js
/**
 * Tool Service - Updated for 10+ products
 * Manages tool execution and product processing
 */

export function createToolService() {
  // Updated to display minimum 10 products
  const MAX_PRODUCTS_TO_DISPLAY = 10;
  const PREFERRED_PRODUCTS_TO_DISPLAY = 12; // Show 12 if available

  /**
   * Helper to fix URLs by prepending shop domain  needed
   */
  const fixUrl = (url, shopDomain) => {
    if (!url) return "";
    if (typeof url !== "string") return "";

    if (url.startsWith("http://") || url.startsWith("https://")) return url;

    const cleanPath = url.startsWith("/") ? url.substring(1) : url;
    return `https://${shopDomain}/${cleanPath}`;
  };

  /**
   * Processes product search results and returns formatted products for display
   * NOW RETURNS MINIMUM 10 PRODUCTS (or all available if less than 10)
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

      const totalProducts = responseData.products.length;
      console.log(`✅ Found ${totalProducts} products in response`);

      // 3. Determine how many products to show
      let productsToShow = PREFERRED_PRODUCTS_TO_DISPLAY;
      if (totalProducts < MAX_PRODUCTS_TO_DISPLAY) {
        // If we have fewer than 10, show all available
        productsToShow = totalProducts;
        console.log(`⚠️ Only ${totalProducts} products available (less than minimum 10)`);
      } else if (totalProducts >= PREFERRED_PRODUCTS_TO_DISPLAY) {
        // If we have 12+, show 12
        productsToShow = PREFERRED_PRODUCTS_TO_DISPLAY;
      } else {
        // If we have 10-11, show 10
        productsToShow = MAX_PRODUCTS_TO_DISPLAY;
      }

      // 4. Process and fix each product
      const fixedProducts = responseData.products.slice(0, productsToShow).map((p) => {
        // Get image URL
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

        // Get variant ID for cart operations
        let variantId = "";
        if (firstVariant && firstVariant.id) {
          variantId = firstVariant.id;
        }

        return {
          id: p.product_id || p.id,
          title: p.title || "Untitled Product",
          image_url: fixedImage,
          url: fixedProductUrl || p.url,
          checkout_url: checkoutUrl,
          price: priceText,
          description: p.description || "",
          variantId: variantId, // Added for direct cart operations
        };
      });

      console.log(`✅ Processed ${fixedProducts.length} products for display`);
      
      // Update the tool response content so Claude also sees the fixed URLs
      // BUT limit what we send to Claude to reduce token usage
      const limitedProducts = fixedProducts.map(p => ({
        id: p.id,
        title: p.title,
        price: p.price,
        url: p.url,
        // Don't send full descriptions back to Claude to save tokens
      }));
      
      responseData.products = limitedProducts;
      toolUseResponse.content[0].text = JSON.stringify({
        ...responseData,
        product_count: fixedProducts.length,
        message: `Found ${fixedProducts.length} products. They are displayed in the UI.`
      });

      // Return full product details for frontend display
      return fixedProducts;
    } catch (error) {
      console.error("❌ Error processing product search results:", error);
      return [];
    }
  };

  /**
   * Helper to create a concise product summary for Claude
   * Prevents verbose descriptions while giving Claude context
   */
  const createProductSummary = (products) => {
    const count = products.length;
    const priceRange = getPriceRange(products);
    
    return {
      product_count: count,
      price_range: priceRange,
      display_message: `${count} products displayed in UI. Products shown with images, prices, and add-to-cart buttons.`
    };
  };

  const getPriceRange = (products) => {
    const prices = products
      .map(p => {
        const priceMatch = p.price?.match(/[\d.]+/);
        return priceMatch ? parseFloat(priceMatch[0]) : null;
      })
      .filter(p => p !== null);

    if (prices.length === 0) return "Varied pricing";

    const min = Math.min(...prices);
    const max = Math.max(...prices);

    if (min === max) return `$${min.toFixed(2)}`;
    return `$${min.toFixed(2)} - $${max.toFixed(2)}`;
  };

  return {
    processProductSearchResult,
    createProductSummary,
  };
}

export default {
  createToolService,
};
