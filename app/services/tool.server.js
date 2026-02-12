export function createToolService() {
  const MAX_PRODUCTS_TO_DISPLAY = 8;

  const processProductSearchResult = (toolUseResponse, shopDomain) => {
    try {
      if (!toolUseResponse?.content || toolUseResponse.content.length === 0) {
        return [];
      }

      let contentText = toolUseResponse.content[0].text;
      let responseData;

      try {
        responseData = typeof contentText === "string" ? JSON.parse(contentText) : contentText;
      } catch (e) {
        console.error("❌ Failed to parse product response:", e);
        return [];
      }

      if (!responseData?.products || !Array.isArray(responseData.products)) {
        console.log("⚠️ No products in response");
        return [];
      }

      console.log(`📦 Processing ${responseData.products.length} products`);

      // ✅ Process each product with URL generation
      const fixedProducts = responseData.products.map((p) => {
        const imageUrl = p.image_url || p.featuredImage?.url || "";
        
        // ✅ CRITICAL: Generate product URL
        let productUrl = null;
        
        if (p.url) {
          productUrl = p.url;
        } else if (p.product_url) {
          productUrl = p.product_url;
        } else if (p.onlineStoreUrl) {
          productUrl = p.onlineStoreUrl;
        } else if (p.handle) {
          // Generate from handle
          productUrl = `https://${shopDomain}/products/${p.handle}`;
        }

        // Ensure absolute URL
        if (productUrl && !productUrl.startsWith("http")) {
          productUrl = `https://${shopDomain}${productUrl.startsWith("/") ? "" : "/"}${productUrl}`;
        }

        // Get variant ID
        let variantId = null;
        if (p.variants && Array.isArray(p.variants) && p.variants.length > 0) {
          variantId = p.variants[0].id || p.variants[0].variant_id || p.variants[0].merchandise_id;
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
          title: p.title || "Untitled",
          image_url: imageUrl,
          url: productUrl, // ✅ ALWAYS HAS URL NOW
          price: priceText,
          description: p.description || "",
          variant_id: variantId,
          merchandise_id: variantId,
          handle: p.handle
        };
      });

      console.log(`✅ Processed ${fixedProducts.length} products with URLs`);

      return fixedProducts.slice(0, MAX_PRODUCTS_TO_DISPLAY);
    } catch (error) {
      console.error("❌ Product processing error:", error);
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

      // ✅ Try multiple checkout URL paths
      const checkoutUrl =
        parsed.checkout_url ||
        parsed.checkoutUrl ||
        parsed.cart?.checkoutUrl ||
        parsed.cart?.checkout_url ||
        parsed.data?.cart?.checkoutUrl ||
        parsed.data?.cart?.checkout_url ||
        parsed.data?.checkoutCreate?.checkout?.url ||
        parsed.data?.checkoutCreate?.checkout?.webUrl ||
        null;

      const cart = parsed.cart || parsed.data?.cart || parsed;

      return { checkoutUrl, cart };
    } catch (error) {
      console.error("❌ Cart processing error:", error);
      return { checkoutUrl: null, cart: null };
    }
  };

  return {
    processProductSearchResult,
    processCartUpdateResult,
  };
}

export default { createToolService };
