// app/services/tool.server.js

export function createToolService() {
  /**
   * Helper to fix URLs by prepending shop domain if needed
   */
  const fixUrl = (url, shopDomain) => {
    if (!url) return '';
    if (url.startsWith('http')) return url;
    // Remove leading slash if present to avoid double slashes
    const cleanPath = url.startsWith('/') ? url.substring(1) : url;
    return `https://${shopDomain}/${cleanPath}`;
  };

  /**
   * Processes product search results and FIXES data for the AI
   */
  const processProductSearchResult = (toolUseResponse, shopDomain) => {
    try {
      console.log("Processing product search result for domain:", shopDomain);
      
      if (toolUseResponse.content && toolUseResponse.content.length > 0) {
        // 1. Parse the JSON content
        let contentText = toolUseResponse.content[0].text;
        let responseData;
        
        try {
          responseData = typeof contentText === 'string' ? JSON.parse(contentText) : contentText;
        } catch (e) {
          console.error("Failed to parse tool content:", e);
          return null;
        }

        // Extra debug to see the raw shape on Railway
        console.log("Raw product search response (first 1 product):", 
          Array.isArray(responseData?.products) ? responseData.products.slice(0, 1) : responseData);

        // 2. Fix Products
        if (responseData?.products && Array.isArray(responseData.products)) {
          const fixedProducts = responseData.products.map(p => {
            // Try to find an image in multiple possible fields
            const rawImageUrl =
              p.image_url ||                      // custom / normalized field
              p.featuredImage?.url ||             // Storefront API featuredImage
              p.image?.url ||                     // sometimes tools might map to image.url
              (p.images &&
                Array.isArray(p.images.edges) &&
                p.images.edges[0]?.node?.url) ||  // first image from images connection
              '';

            const fixedImage = fixUrl(rawImageUrl, shopDomain);

            // Fix Product URL
            const rawProductUrl =
              p.url ||             // normalized url
              p.onlineStoreUrl ||  // Storefront API field
              '';

            const fixedProductUrl = fixUrl(rawProductUrl, shopDomain);

            // Generate Checkout URL (if variant exists and has id)
            let checkoutUrl = '';
            const firstVariant =
              Array.isArray(p.variants) && p.variants.length > 0
                ? p.variants[0]
                : null;

            if (firstVariant && firstVariant.id) {
              const variantGid = firstVariant.id;
              // Only try replace if it's a string and includes the expected prefix
              let numericVariantId = variantGid;
              const prefix = 'gid://shopify/ProductVariant/';
              if (typeof variantGid === 'string' && variantGid.startsWith(prefix)) {
                numericVariantId = variantGid.replace(prefix, '');
              }
              checkoutUrl = `https://${shopDomain}/cart/${numericVariantId}:1`;
            }

            return {
              ...p,
              image_url: fixedImage,
              url: fixedProductUrl,
              checkout_url: checkoutUrl,
            };
          });

          // 3. Update the response data with fixed products
          responseData.products = fixedProducts;
          
          // 4. Update the actual toolUseResponse content so Claude sees the FIXED URLs
          toolUseResponse.content[0].text = JSON.stringify(responseData);
          
          // Return for display if needed
          return fixedProducts.slice(0, AppConfig.tools.maxProductsToDisplay);
        }
      }
      return [];
    } catch (error) {
      console.error("Error processing product search results:", error);
      return [];
    }
  };

  return {
    processProductSearchResult
  };
}

export default {
  createToolService
};
