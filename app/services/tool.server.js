// app/services/tool.server.js
/**
 * Tool Service
 * Manages tool execution and processing
 */
import { saveMessage } from "../db.server";
import AppConfig from "./config.server";

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

        // 2. Fix Products
        if (responseData?.products && Array.isArray(responseData.products)) {
          const fixedProducts = responseData.products.map(p => {
             // Fix Image URL
             const fixedImage = fixUrl(p.image_url || p.featuredImage?.url, shopDomain);
             
             // Fix Product URL
             const fixedProductUrl = fixUrl(p.url || p.onlineStoreUrl, shopDomain);

             // Generate Checkout URL (if variant exists)
             let checkoutUrl = '';
             if (p.variants && p.variants.length > 0) {
                const variantId = p.variants[0].id.replace('gid://shopify/ProductVariant/', '');
                checkoutUrl = `https://${shopDomain}/cart/${variantId}:1`;
             }

             return {
                ...p,
                image_url: fixedImage,
                url: fixedProductUrl,
                checkout_url: checkoutUrl
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
