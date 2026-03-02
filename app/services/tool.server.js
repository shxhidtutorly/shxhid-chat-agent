/**
 * Tool Service
 * Processes MCP tool responses (product search, cart updates)
 * Includes variant-level spec matching and dimension parsing
 */

/**
 * Extract specs (dimensions, SKU patterns) from a query string.
 * Handles patterns like:
 *   - "77mm", "30 mm", "77 mm length", "body width 30mm"
 *   - SKU: "3NA7836", "6SL3220-1YE34-0UF0", "5SL4363-8"
 */
function extractQuerySpecs(query) {
  if (!query || typeof query !== 'string') return { dimensions: [], skuPatterns: [], rawNumbers: [] };

  // Extract dimensions: "77mm", "30 mm", "200mm", "50cm"
  const dimRegex = /(\d+(?:\.\d+)?)\s*(?:mm|cm)\b/gi;
  const dimensions = [];
  let m;
  while ((m = dimRegex.exec(query)) !== null) {
    dimensions.push(parseFloat(m[1]));
  }

  // Also extract standalone numbers near dimension keywords:
  // "length 77", "width 30", "77 length", "30 width", "bore 50"
  const contextDimRegex = /(?:length|width|height|bore|diameter|size|thick)\s*[:\-]?\s*(\d+(?:\.\d+)?)|(\d+(?:\.\d+)?)\s*(?:length|width|height|bore|diameter|size|thick)/gi;
  while ((m = contextDimRegex.exec(query)) !== null) {
    const val = parseFloat(m[1] || m[2]);
    if (val && !dimensions.includes(val)) {
      dimensions.push(val);
    }
  }

  // Extract SKU-like patterns: alphanumeric with hyphens/dots, 3+ chars, must have digit+letter
  const skuRegex = /\b([A-Z0-9][A-Z0-9\-\.\/]{2,}[A-Z0-9])\b/gi;
  const skuPatterns = [];
  while ((m = skuRegex.exec(query)) !== null) {
    const token = m[1].toUpperCase();
    // Must contain at least one digit and one letter
    if (/\d/.test(token) && /[A-Z]/i.test(token)) {
      // Filter out common non-SKU words
      if (!['HTTP', 'HTTPS', 'HTML', 'JSON', 'UUID'].includes(token)) {
        skuPatterns.push(token);
      }
    }
  }

  // Extract raw numbers that might be amp/volt/watt ratings: "100A", "200A", "63A"
  const ratingRegex = /(\d+)\s*[AaVvWw]\b/g;
  const rawNumbers = [];
  while ((m = ratingRegex.exec(query)) !== null) {
    rawNumbers.push(parseFloat(m[1]));
  }

  return { dimensions, skuPatterns, rawNumbers };
}

/**
 * Build searchable text from all product data including variants.
 */
function buildProductSearchText(product) {
  const parts = [
    product.title || '',
    product.description || '',
    product.sku || '',
    product.vendor || '',
    product.product_type || '',
  ];

  if (Array.isArray(product.variants)) {
    for (const v of product.variants) {
      parts.push(v.title || '', v.sku || '', v.option1 || '', v.option2 || '', v.option3 || '');
    }
  }

  if (Array.isArray(product.tags)) {
    parts.push(...product.tags);
  } else if (typeof product.tags === 'string') {
    parts.push(product.tags);
  }

  return parts.join(' ');
}

/**
 * Score a product by how well it matches extracted specs.
 * Higher score = better match. 0 = no spec match (neutral).
 */
function scoreProductBySpecs(product, specs) {
  if (!specs.dimensions.length && !specs.skuPatterns.length && !specs.rawNumbers.length) return 0;

  let score = 0;
  const searchText = buildProductSearchText(product);
  const searchUpper = searchText.toUpperCase();
  const searchLower = searchText.toLowerCase();

  // 1. SKU matching — highest priority (100 points per exact match)
  for (const sku of specs.skuPatterns) {
    if (searchUpper.includes(sku)) {
      score += 100;
    } else {
      // Try without separators
      const skuNorm = sku.replace(/[-\.\/]/g, '');
      const searchNorm = searchUpper.replace(/[-\.\/]/g, '');
      if (searchNorm.includes(skuNorm)) {
        score += 80;
      }
    }
  }

  // 2. Dimension matching (25 points per dimension match)
  for (const dim of specs.dimensions) {
    const dimStr = String(dim);
    // "77mm" or "77 mm"
    if (searchLower.includes(dimStr + 'mm') || searchLower.includes(dimStr + ' mm')) {
      score += 25;
    }
    // "77cm" or "77 cm"
    else if (searchLower.includes(dimStr + 'cm') || searchLower.includes(dimStr + ' cm')) {
      score += 25;
    }
    // Just the number present in text (weaker signal)
    else if (searchText.includes(dimStr)) {
      score += 5;
    }
  }

  // 3. Rating matching (10 points per match) — e.g. "63A", "200A"
  for (const num of specs.rawNumbers) {
    const numStr = String(num);
    if (searchLower.includes(numStr + 'a') || searchLower.includes(numStr + ' a')) {
      score += 10;
    }
  }

  return score;
}

export function createToolService() {
  const MAX_PRODUCTS_TO_DISPLAY = 8;

  /**
   * Resolve a product URL safely.
   * NEVER fabricate a slug from the product title.
   */
  function resolveProductUrl(product, shopDomain) {
    if (product.handle) {
      return `https://${shopDomain}/products/${product.handle}`;
    }

    const rawUrl = product.product_url || product.url || '';
    if (rawUrl) {
      const productsMatch = rawUrl.match(/\/products\/([a-z0-9][a-z0-9\-]*)/i);
      if (productsMatch && productsMatch[1]) {
        return `https://${shopDomain}/products/${productsMatch[1]}`;
      }
      if (rawUrl.startsWith('http')) {
        return rawUrl;
      }
    }

    return null;
  }

  /**
   * Process product search results from MCP tool response.
   * Includes variant-level spec matching and dimension filtering.
   *
   * @param {Object} toolUseResponse - Raw MCP tool response
   * @param {string} shopDomain - Shop domain for URL building
   * @param {string} [userQuery] - Original user message for spec extraction
   * @param {string} [searchQuery] - The search query Claude used
   */
  const processProductSearchResult = (toolUseResponse, shopDomain, userQuery, searchQuery) => {
    try {
      if (!toolUseResponse?.content || toolUseResponse.content.length === 0) {
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
        return [];
      }

      const resultCount = responseData.products.length;
      console.log(`[ToolService] Search returned ${resultCount} products`);

      // Extract specs from BOTH user query and search query for maximum coverage
      const userSpecs = extractQuerySpecs(userQuery || '');
      const searchSpecs = extractQuerySpecs(searchQuery || '');

      // Merge specs (deduplicate)
      const mergedSpecs = {
        dimensions: [...new Set([...userSpecs.dimensions, ...searchSpecs.dimensions])],
        skuPatterns: [...new Set([...userSpecs.skuPatterns, ...searchSpecs.skuPatterns])],
        rawNumbers: [...new Set([...userSpecs.rawNumbers, ...searchSpecs.rawNumbers])],
      };

      const hasSpecs = mergedSpecs.dimensions.length > 0 || mergedSpecs.skuPatterns.length > 0 || mergedSpecs.rawNumbers.length > 0;

      if (hasSpecs) {
        console.log(`[ToolService] Specs — dims: [${mergedSpecs.dimensions}], SKUs: [${mergedSpecs.skuPatterns}], ratings: [${mergedSpecs.rawNumbers}]`);
      }

      const fixedProducts = responseData.products.map((p) => {
        const rawImageUrl = p.image_url || p.featuredImage?.url || '';
        const productUrl = resolveProductUrl(p, shopDomain);

        let firstVariant = null;
        if (Array.isArray(p.variants) && p.variants.length > 0) {
          firstVariant = p.variants[0];
        }
        const variantIdRaw = firstVariant?.id || firstVariant?.variant_id || null;

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

        const specScore = hasSpecs ? scoreProductBySpecs(p, mergedSpecs) : 0;

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

      // Sort by spec score and filter if specs were found
      let rankedProducts = fixedProducts;
      if (hasSpecs) {
        rankedProducts.sort((a, b) => b._specScore - a._specScore);

        const topScore = rankedProducts[0]?._specScore || 0;
        if (topScore > 0) {
          const matched = rankedProducts.filter(p => p._specScore > 0);
          if (matched.length > 0) {
            console.log(`[ToolService] Spec filter: ${matched.length}/${fixedProducts.length} matched (top: ${topScore})`);
            rankedProducts = matched;

            // If exact SKU match (score >= 100), return ONLY exact matches
            if (topScore >= 100) {
              const exactMatches = rankedProducts.filter(p => p._specScore >= 100);
              if (exactMatches.length > 0) {
                console.log(`[ToolService] Exact SKU match: returning ${exactMatches.length} products only`);
                rankedProducts = exactMatches;
              }
            }
          }
        }
      }

      // Remove internal scoring field
      rankedProducts.forEach(p => delete p._specScore);

      console.log(`[ToolService] Returning ${Math.min(rankedProducts.length, MAX_PRODUCTS_TO_DISPLAY)} products`);

      // Update tool response so Claude sees processed data
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
