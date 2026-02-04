// app/services/tool.server.js
/**
 * Tool Service - Optimized & Robust Version
 * Manages tool execution and product processing with efficient handling
 */

export function createToolService() {
  // Product display configuration
  const MAX_PRODUCTS_TO_DISPLAY = 12;
  const MIN_PRODUCTS_TO_DISPLAY = 10;

  /**
   * Robust URL fixer with validation
   * Handles all edge cases for product URLs and images
   */
  const fixUrl = (url, shopDomain) => {
    if (!url || typeof url !== "string") return "";
    
    // Already a complete URL
    if (url.startsWith("http://") || url.startsWith("https://")) {
      return url;
    }
    
    // Relative URL - prepend shop domain
    const cleanPath = url.startsWith("/") ? url.slice(1) : url;
    const cleanDomain = shopDomain.replace(/^https?:\/\//, "").replace(/\/$/, "");
    
    return `https://${cleanDomain}/${cleanPath}`;
  };

  /**
   * Extract numeric variant ID from GID
   */
  const extractVariantId = (gid) => {
    if (!gid) return null;
    
    const prefix = "gid://shopify/ProductVariant/";
    if (typeof gid === "string" && gid.startsWith(prefix)) {
      return gid.replace(prefix, "");
    }
    
    return gid;
  };

  /**
   * Process and format a single product
   */
  const formatProduct = (product, shopDomain) => {
    try {
      // Extract image URL with fallbacks
      const rawImageUrl = 
        product.image_url ||
        product.imageUrl ||
        product.featuredImage?.url ||
        product.image?.url ||
        (Array.isArray(product.images?.edges) && product.images.edges[0]?.node?.url) ||
        (Array.isArray(product.images) && product.images[0]?.url) ||
        "";

      const imageUrl = fixUrl(rawImageUrl, shopDomain);

      // Extract product URL with fallbacks
      const rawProductUrl = 
        product.url || 
        product.onlineStoreUrl || 
        product.product_url ||
        "";

      const productUrl = fixUrl(rawProductUrl, shopDomain);

      // Get first variant
      let firstVariant = null;
      if (Array.isArray(product.variants) && product.variants.length > 0) {
        firstVariant = product.variants[0];
      } else if (product.variant) {
        firstVariant = product.variant;
      }

      // Extract variant ID
      let variantId = null;
      let checkoutUrl = "";

      if (firstVariant?.id) {
        variantId = firstVariant.id;
        const numericId = extractVariantId(variantId);
        
        if (numericId) {
          checkoutUrl = `https://${shopDomain.replace(/^https?:\/\//, "")}/cart/${numericId}:1`;
        }
      }

      // Format price
      let priceText = "";
      if (product.price) {
        priceText = product.price;
      } else if (firstVariant?.price) {
        const price = firstVariant.price;
        const currency = firstVariant.currency || product.currency || "USD";
        priceText = `${price} ${currency}`;
      } else if (product.price_range) {
        const pr = product.price_range;
        const currency = pr.currency || "USD";
        
        if (pr.min && pr.max && pr.min !== pr.max) {
          priceText = `${pr.min} - ${pr.max} ${currency}`;
        } else if (pr.min) {
          priceText = `${pr.min} ${currency}`;
        }
      }

      // Extract description (truncate if too long)
      const description = product.description || product.body || "";
      const truncatedDescription = description.length > 200 
        ? description.substring(0, 200) + "..." 
        : description;

      return {
        id: product.product_id || product.id || `product_${Date.now()}`,
        title: product.title || "Untitled Product",
        image_url: imageUrl,
        url: productUrl,
        checkout_url: checkoutUrl,
        price: priceText,
        description: truncatedDescription,
        variantId: variantId,
        sku: product.sku || firstVariant?.sku || "",
        available: product.available ?? firstVariant?.available ?? true,
      };
    } catch (error) {
      console.error("Error formatting product:", error);
      return null;
    }
  };

  /**
   * Process product search results
   * Returns formatted products ready for frontend display
   * Updates tool response with concise summary for Claude
   */
  const processProductSearchResult = (toolUseResponse, shopDomain) => {
    try {
      console.log("🔍 Processing product search for:", shopDomain);

      // Validate response structure
      if (!toolUseResponse?.content || !Array.isArray(toolUseResponse.content) || toolUseResponse.content.length === 0) {
        console.warn("⚠️ Invalid tool response structure");
        return [];
      }

      // Parse content
      let contentText = toolUseResponse.content[0].text;
      let responseData;

      try {
        responseData = typeof contentText === "string" 
          ? JSON.parse(contentText) 
          : contentText;
      } catch (parseError) {
        console.error("❌ Failed to parse tool content:", parseError);
        return [];
      }

      // Validate products array
      if (!responseData?.products || !Array.isArray(responseData.products)) {
        console.warn("⚠️ No products array in response");
        return [];
      }

      const totalProducts = responseData.products.length;
      console.log(`✅ Found ${totalProducts} products in response`);

      // Determine how many to show
      let productsToShow = Math.min(totalProducts, MAX_PRODUCTS_TO_DISPLAY);
      
      if (totalProducts < MIN_PRODUCTS_TO_DISPLAY) {
        console.log(`⚠️ Only ${totalProducts} products (less than recommended ${MIN_PRODUCTS_TO_DISPLAY})`);
      }

      // Format products with error handling
      const formattedProducts = responseData.products
        .slice(0, productsToShow)
        .map(p => formatProduct(p, shopDomain))
        .filter(p => p !== null); // Remove any failed products

      console.log(`✅ Successfully formatted ${formattedProducts.length} products`);

      // Create concise summary for Claude (saves tokens)
      const productSummary = createProductSummary(formattedProducts);

      // Update tool response with concise info for Claude
      toolUseResponse.content[0].text = JSON.stringify({
        success: true,
        product_count: formattedProducts.length,
        products_displayed: true,
        summary: productSummary,
        // Include minimal product info for Claude's context
        sample_products: formattedProducts.slice(0, 3).map(p => ({
          title: p.title,
          price: p.price,
        })),
      });

      return formattedProducts;

    } catch (error) {
      console.error("❌ Critical error in processProductSearchResult:", error);
      return [];
    }
  };

  /**
   * Create concise product summary for Claude
   * Prevents verbose responses while giving context
   */
  const createProductSummary = (products) => {
    if (!products || products.length === 0) {
      return "No products found";
    }

    const count = products.length;
    const priceRange = getPriceRange(products);
    const availableCount = products.filter(p => p.available).length;

    return `${count} products displayed with images and add-to-cart buttons. ${priceRange}. ${availableCount} available.`;
  };

  /**
   * Extract price range from products
   */
  const getPriceRange = (products) => {
    const prices = products
      .map(p => {
        if (!p.price) return null;
        const priceMatch = p.price.match(/[\d.]+/);
        return priceMatch ? parseFloat(priceMatch[0]) : null;
      })
      .filter(p => p !== null);

    if (prices.length === 0) return "Pricing varies";

    const min = Math.min(...prices);
    const max = Math.max(...prices);

    if (min === max) {
      return `$${min.toFixed(2)}`;
    }

    return `$${min.toFixed(2)} - $${max.toFixed(2)}`;
  };

  /**
   * Process cart update results
   * Returns formatted cart data
   */
  const processCartUpdateResult = (toolUseResponse) => {
    try {
      if (!toolUseResponse?.content || toolUseResponse.content.length === 0) {
        return null;
      }

      let contentText = toolUseResponse.content[0].text;
      let cartData;

      try {
        cartData = typeof contentText === "string" 
          ? JSON.parse(contentText) 
          : contentText;
      } catch (e) {
        console.error("Failed to parse cart content:", e);
        return null;
      }

      // Extract cart info
      const cart = cartData.cart || cartData;
      
      return {
        cartId: cart.id || cart.cart_id,
        checkoutUrl: cart.checkoutUrl || cart.checkout_url,
        totalQuantity: cart.totalQuantity || cart.total_quantity || 0,
        estimatedCost: cart.estimatedCost || cart.estimated_cost,
        lines: cart.lines || [],
      };

    } catch (error) {
      console.error("Error processing cart update:", error);
      return null;
    }
  };

  /**
   * Validate product data structure
   */
  const validateProductData = (product) => {
    return {
      isValid: !!(product && product.title),
      hasImage: !!(product.image_url || product.imageUrl),
      hasPrice: !!(product.price || product.price_range),
      hasUrl: !!(product.url || product.onlineStoreUrl),
      hasVariant: !!(product.variantId || product.variant_id),
    };
  };

  return {
    processProductSearchResult,
    processCartUpdateResult,
    createProductSummary,
    validateProductData,
    formatProduct,
    fixUrl,
  };
}

export default {
  createToolService,
};
