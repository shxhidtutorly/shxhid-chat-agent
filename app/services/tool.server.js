/**
 * Tool Service
 * Processes MCP tool responses (product search, cart updates)
 * Includes variant-level spec matching and dimension parsing
 */

/**
 * Extract specs (dimensions, SKU patterns) from a query string.
 * Used to filter/rank search results by relevance.
 */
function extractQuerySpecs(query) {
  if (!query || typeof query !== 'string') return { dimensions: [], skuPatterns: [] };

  // Extract dimensions like "77mm", "30mm", "239 mm", "200mm", "50 mm"
  const dimRegex = /(\d+(?:\.\d+)?)\s*(?:mm|cm)\b/gi;
  const dimensions = [];
  let m;
  while ((m = dimRegex.exec(query)) !== null) {
    dimensions.push(parseFloat(m[1]));
  }

  // Extract SKU-like patterns (alphanumeric with hyphens/dots, 4+ chars, must have digit+letter)
  const skuRegex = /\b([A-Z0-9][A-Z0-9\-\.]{2,}[A-Z0-9])\b/gi;
  const skuPatterns = [];
  while ((m = skuRegex.exec(query)) !== null) {
    const token = m[1].toUpperCase();
    if (/\d/.test(token) && /[A-Z]/i.test(token)) {
      skuPatterns.push(token);
    }
  }

  return { dimensions, skuPatterns };
}

/**
 * Score a product by how well it matches extracted specs.
 * Higher score = better match. 0 = no spec match (neutral).
 */
function scoreProductBySpecs(product, specs) {
  if (!specs.dimensions.length && !specs.skuPatterns.length) return 0;

  let score = 0;

  // Build searchable text from all product data
  const textParts = [
    product.title || '',
    product.description || '',
    product.sku || '',
  ];

  // Include variant data
  if (Array.isArray(product.variants)) {
    for (const v of product.variants) {
      textParts.push(v.title || '', v.sku || '');
    }
  }

  // Include tags
  if (Array.isArray(product.tags)) {
    textParts.push(...product.tags);
  }

  const searchText = textParts.join(' ');
  const searchTextUpper = searchText.toUpperCase();

  // SKU matching — highest priority
  for (const sku of specs.skuPatterns) {
    if (searchTextUpper.includes(sku)) {
      score += 100;
    } else if (searchTextUpper.includes(sku.replace(/[-\.]/g, ''))) {
      score += 80; // Match without separators
    }
  }

  // Dimension matching
  for (const dim of specs.dimensions) {
    const dimStr = String(dim);
    const searchLower = searchText.toLowerCase();
    // Check "77mm" or "77 mm"
    if (searchLower.includes(dimStr + 'mm') || searchLower.includes(dimStr + ' mm')) {
      score += 25;
    } else if (searchText.includes(dimStr)) {
      score += 10;
    }
  }

  return score;
}

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
   *
   * @param {Object} toolUseResponse - Raw MCP tool response
   * @param {string} shopDomain - Shop domain for URL building
   * @param {string} [userQuery] - Original user message for spec extraction
   * @param {string} [searchQuery] - The search query Claude used
   */
  const processProductSearchResult = (toolUseResponse, shopDomain, userQuery, searchQuery) => {
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

      // Extract specs from user query for filtering
      const queryForSpecs = userQuery || searchQuery || '';
      const specs = extractQuerySpecs(queryForSpecs);
      const hasSpecs = specs.dimensions.length > 0 || specs.skuPatterns.length > 0;

      if (hasSpecs) {
        console.log(`[ToolService] Extracted specs — dimensions: [${specs.dimensions.join(', ')}], SKUs: [${specs.skuPatterns.join(', ')}]`);
      }

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

        // Score product by spec match
        const specScore = hasSpecs ? scoreProductBySpecs(p, specs) : 0;

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
          _specScore: specScore,
        };
      });

      // If specs were extracted, sort by spec score (best matches first)
      // and filter out zero-score products if there are high-score ones
      let rankedProducts = fixedProducts;
      if (hasSpecs) {
        rankedProducts.sort((a, b) => b._specScore - a._specScore);

        const topScore = rankedProducts[0]?._specScore || 0;
        if (topScore > 0) {
          // Keep only products that scored (matched at least one spec)
          const matched = rankedProducts.filter(p => p._specScore > 0);
          if (matched.length > 0) {
            console.log(`[ToolService] Spec filtering: ${matched.length}/${fixedProducts.length} products matched specs (top score: ${topScore})`);
            rankedProducts = matched;
          }
        }
      }

      // Remove internal scoring field before sending
      rankedProducts.forEach(p => delete p._specScore);

      console.log(`[ToolService] Returning ${Math.min(rankedProducts.length, MAX_PRODUCTS_TO_DISPLAY)} products`);

      // Update tool response content so Claude sees the processed data
      responseData.products = rankedProducts;
      toolUseResponse.content[0].text = JSON.stringify(responseData);

      return rankedProducts.slice(0, MAX_PRODUCTS_TO_DISPLAY);
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
