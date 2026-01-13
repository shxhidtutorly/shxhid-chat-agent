// app/services/tool.server.js
/**
 * Tool Service
 * Manages tool execution and processing
 */

import { saveMessage } from "../db.server";

// If you still need AppConfig elsewhere, you can import it there,
// but we will NOT rely on it inside this function to avoid runtime issues.
// import AppConfig from "./config.server";

export function createToolService() {
  // Local constant instead of AppConfig to avoid runtime ReferenceError
  const MAX_PRODUCTS_TO_DISPLAY = 8; // adjust to whatever you want

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
   * Processes product search results and FIXES data for the AI
   */
  const processProductSearchResult = (toolUseResponse, shopDomain) => {
    try {
      console.log("Processing product search result for domain:", shopDomain);

      if (toolUseResponse?.content && toolUseResponse.content.length > 0) {
        // 1. Parse the JSON content
        let contentText = toolUseResponse.content[0].text;
        let responseData;

        try {
          responseData =
            typeof contentText === "string"
              ? JSON.parse(contentText)
              : contentText;
        } catch (e) {
          console.error("Failed to parse tool content:", e);
          return [];
        }

        // Extra debug to see the raw shape on Railway
        if (Array.isArray(responseData?.products)) {
          console.log(
            "Raw product search response (first 1 product):",
            responseData.products.slice(0, 1)
          );
        } else {
          console.log(
            "Raw product search response (no products array):",
            responseData
          );
        }

        // 2. Fix Products
        if (responseData?.products && Array.isArray(responseData.products)) {
          const fixedProducts = responseData.products.map((p) => {
            // Try to find an image in multiple possible fields
            const rawImageUrl =
              p.image_url || // your tool already returns this (as shown in logs)
              p.featuredImage?.url || // Storefront API featuredImage
              p.image?.url || // some tools map to image.url
              (p.images &&
                Array.isArray(p.images.edges) &&
                p.images.edges[0]?.node?.url) || // first image from images connection
              "";

            const fixedImage = fixUrl(rawImageUrl, shopDomain);

            // Fix Product URL if available (may not be present in your current tool result)
            const rawProductUrl = p.url || p.onlineStoreUrl || "";
            const fixedProductUrl = fixUrl(rawProductUrl, shopDomain);

            // Generate Checkout URL (if variant exists and has id)
            let checkoutUrl = "";
            let firstVariant = null;

            if (Array.isArray(p.variants) && p.variants.length > 0) {
              firstVariant = p.variants[0];
            }

            if (firstVariant && firstVariant.id) {
              const variantGid = firstVariant.id;
              let numericVariantId = variantGid;

              const prefix = "gid://shopify/ProductVariant/";
              if (
                typeof variantGid === "string" &&
                variantGid.startsWith(prefix)
              ) {
                numericVariantId = variantGid.replace(prefix, "");
              }

              checkoutUrl = `https://${shopDomain}/cart/${numericVariantId}:1`;
            }

            return {
              ...p,
              // Normalize the key that the chat UI / Claude prompt uses
              image_url: fixedImage,
              url: fixedProductUrl || p.url, // keep existing URL if already absolute
              checkout_url: checkoutUrl,
            };
          });

          // 3. Update the response data with fixed products
          responseData.products = fixedProducts;

          // 4. Update the actual toolUseResponse content so Claude sees the FIXED URLs
          toolUseResponse.content[0].text = JSON.stringify(responseData);

          // Return for display if needed
          return fixedProducts.slice(0, MAX_PRODUCTS_TO_DISPLAY);
        }
      }

      return [];
    } catch (error) {
      console.error("Error processing product search results:", error);
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
