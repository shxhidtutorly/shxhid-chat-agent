/**
 * Tool Service — v2.1
 * Processes MCP tool responses (product search, cart updates)
 *
 * CHANGES (v2.1 — April 2026 production fix):
 *   - Accept multiple product-list shapes: { products }, { items }, { results }.
 *     The new Shopify `search_catalog` tool may use a different key than the
 *     legacy `search_shop_catalog` tool did.
 *   - Added brand/keyword relevance gate: if the user's distinctive query tokens
 *     match NO returned products, drop everything and return []. Shopify's search
 *     is fuzzy — for "ifm sensors" against a catalog with no IFM items it was
 *     returning Mindman pneumatic cylinders. Returning [] routes execution into
 *     the zero-results fallback + retry-hint path in chat.jsx.
 *
 * CHANGES (v2.0):
 *   - Fixed false-positive SKU detection (24VDC, CAT5, RJ45, 25MM no longer treated as SKUs)
 *   - Added blocklist for common industrial spec tokens
 *   - Tightened SKU regex: requires 5+ chars OR must contain a separator (- . /)
 *   - Moved "NNmm" pattern from SKU matching to dimension matching
 *   - Increased MAX_PRODUCTS_TO_DISPLAY from 8 to 12
 */

// ──────────────────────────────────────────────
// Blocklist: tokens that LOOK like SKUs but are
// actually voltage ratings, cable categories,
// dimension strings, or protocol names.
// ──────────────────────────────────────────────
const SPEC_TOKEN_BLOCKLIST = new Set([
  // Voltage ratings
  '24VDC', '12VDC', '48VDC', '5VDC', '24VAC', '110VAC', '120VAC',
  '220VAC', '230VAC', '240VAC', '380VAC', '400VAC', '415VAC', '480VAC',
  '600VAC', '24V', '12V', '48V', '5V', '110V', '120V', '220V', '230V',
  '240V', '380V', '400V', '415V', '480V', '600V',
  // Cable categories
  'CAT5', 'CAT5E', 'CAT6', 'CAT6A', 'CAT7', 'CAT7A', 'CAT8',
  // Connector types
  'RJ45', 'RJ11', 'RJ12', 'DB9', 'DB15', 'DB25',
  // Protocols & standards
  'RS232', 'RS485', 'RS422', 'IP67', 'IP68', 'IP65', 'IP54', 'IP55',
  'IP20', 'IP44', 'IEC61131', 'NEMA4', 'NEMA12',
  // Generic amp / watt tokens that are too short
  'AC1', 'DC1', 'AC3', 'DC3',
  // Common non-SKU acronyms
  'HTTP', 'HTTPS', 'HTML', 'JSON', 'UUID', 'MQTT', 'OPCUA',
  'MODBUS', 'TCPIP', 'PROFINET', 'PROFIBUS', 'CANOPEN', 'ETHERCAT',
  'USB', 'HDMI', 'DVI', 'VGA',
  // Pipe sizes
  'NPT', 'BSP', 'BSPT', 'BSPP',
]);

// ──────────────────────────────────────────────
// v2.1: Stopwords used by the relevance gate.
// Words on this list do NOT count as distinctive
// query tokens, so "show me sensors" still shows
// whatever the store has under "sensor".
// ──────────────────────────────────────────────
const RELEVANCE_STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "for", "of", "with", "in", "on", "to", "me", "my",
  "show", "find", "need", "want", "do", "you", "have", "got", "some", "any", "please",
  "i", "is", "are", "can", "could", "would", "looking", "search",
  "product", "products", "part", "parts", "item", "items",
  // Generic product categories — intentionally allowed to pass through
  // so users browsing "sensors" or "cables" still see results.
  "sensor", "sensors", "cable", "cables", "valve", "valves",
  "breaker", "breakers", "fuse", "fuses", "relay", "relays",
]);

function isBlocklistedToken(token) {
  const upper = token.toUpperCase();
  if (SPEC_TOKEN_BLOCKLIST.has(upper)) return true;

  if (/^\d+MM$/i.test(token)) return true;
  if (/^\d+CM$/i.test(token)) return true;
  if (/^\d+[AVWW]$/i.test(token)) return true;
  if (/^IP\d{2}$/i.test(token)) return true;

  return false;
}

function extractQuerySpecs(query) {
  if (!query || typeof query !== 'string') return { dimensions: [], skuPatterns: [], rawNumbers: [] };

  const dimRegex = /(\d+(?:\.\d+)?)\s*(?:mm|cm)\b/gi;
  const dimensions = [];
  let m;
  while ((m = dimRegex.exec(query)) !== null) {
    dimensions.push(parseFloat(m[1]));
  }

  const contextDimRegex = /(?:length|width|height|bore|diameter|size|thick|stroke)\s*[:\-]?\s*(\d+(?:\.\d+)?)|(\d+(?:\.\d+)?)\s*(?:length|width|height|bore|diameter|size|thick|stroke)/gi;
  while ((m = contextDimRegex.exec(query)) !== null) {
    const val = parseFloat(m[1] || m[2]);
    if (val && !dimensions.includes(val)) {
      dimensions.push(val);
    }
  }

  const skuRegex = /\b([A-Z0-9][A-Z0-9\-\.\/]{1,}[A-Z0-9])\b/gi;
  const skuPatterns = [];
  while ((m = skuRegex.exec(query)) !== null) {
    const token = m[1].toUpperCase();
    if (!/\d/.test(token) || !/[A-Z]/i.test(token)) continue;
    const hasSeparator = /[-\.\/]/.test(token);
    if (token.length < 5 && !hasSeparator) continue;
    if (isBlocklistedToken(token)) continue;
    skuPatterns.push(token);
  }

  const ratingRegex = /(\d+)\s*[AaVvWw]\b/g;
  const rawNumbers = [];
  while ((m = ratingRegex.exec(query)) !== null) {
    rawNumbers.push(parseFloat(m[1]));
  }

  return { dimensions, skuPatterns, rawNumbers };
}

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

function scoreProductBySpecs(product, specs) {
  if (!specs.dimensions.length && !specs.skuPatterns.length && !specs.rawNumbers.length) return 0;

  let score = 0;
  const searchText = buildProductSearchText(product);
  const searchUpper = searchText.toUpperCase();
  const searchLower = searchText.toLowerCase();

  for (const sku of specs.skuPatterns) {
    if (searchUpper.includes(sku)) {
      score += 100;
    } else {
      const skuNorm = sku.replace(/[-\.\/]/g, '');
      const searchNorm = searchUpper.replace(/[-\.\/]/g, '');
      if (searchNorm.includes(skuNorm)) {
        score += 80;
      }
    }
  }

  for (const dim of specs.dimensions) {
    const dimStr = String(dim);
    if (searchLower.includes(dimStr + 'mm') || searchLower.includes(dimStr + ' mm')) {
      score += 25;
    } else if (searchLower.includes(dimStr + 'cm') || searchLower.includes(dimStr + ' cm')) {
      score += 25;
    } else if (searchText.includes(dimStr)) {
      score += 5;
    }
  }

  for (const num of specs.rawNumbers) {
    const numStr = String(num);
    if (searchLower.includes(numStr + 'a') || searchLower.includes(numStr + ' a')) {
      score += 10;
    }
  }

  return score;
}

/**
 * v2.1: Extract distinctive tokens from the user/search query for the relevance gate.
 * Returns tokens that are ≥3 chars, alphanumeric, not stopwords, not blocklisted specs.
 * These are the words that MUST appear in a product for it to be considered relevant.
 */
function extractDistinctiveTokens(query) {
  if (!query || typeof query !== 'string') return [];
  return query
    .toLowerCase()
    .split(/[^a-z0-9]+/i)
    .filter(t =>
      t.length >= 3 &&
      !RELEVANCE_STOPWORDS.has(t) &&
      !isBlocklistedToken(t)
    );
}

export function createToolService() {
  const MAX_PRODUCTS_TO_DISPLAY = 12;

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

      // v2.1: accept multiple product-list keys and normalise into .products.
      const rawProducts =
        (Array.isArray(responseData?.products) && responseData.products) ||
        (Array.isArray(responseData?.items)    && responseData.items)    ||
        (Array.isArray(responseData?.results)  && responseData.results)  ||
        [];

      if (rawProducts.length === 0) {
        return [];
      }
      responseData.products = rawProducts;

      const resultCount = rawProducts.length;
      console.log(`[ToolService] Search returned ${resultCount} products`);

      // ─────────────────────────────────────────────
      // v2.1: BRAND / KEYWORD RELEVANCE GATE
      // Drop fuzzy-match junk before it reaches Claude or the UI.
      // If the user typed a distinctive token (likely a brand or model)
      // and NO product contains any of those tokens, return [] so the
      // zero-results fallback path fires in chat.jsx.
      // ─────────────────────────────────────────────
      const distinctiveTokens = Array.from(new Set([
        ...extractDistinctiveTokens(searchQuery || ''),
        ...extractDistinctiveTokens(userQuery || ''),
      ]));

      if (distinctiveTokens.length > 0) {
        const matched = responseData.products.filter(p => {
          const hay = buildProductSearchText(p).toLowerCase();
          return distinctiveTokens.some(t => hay.includes(t));
        });

        if (matched.length === 0) {
          console.log(
            `[ToolService] Relevance gate: 0/${responseData.products.length} products match ` +
            `tokens [${distinctiveTokens.join(', ')}] — dropping all, will trigger fallback`
          );
          return [];
        }

        if (matched.length < responseData.products.length) {
          console.log(
            `[ToolService] Relevance gate: kept ${matched.length}/${responseData.products.length} ` +
            `(tokens: ${distinctiveTokens.join(', ')})`
          );
          responseData.products = matched;
        }
      }

      // Spec extraction and scoring (unchanged behaviour).
      const userSpecs = extractQuerySpecs(userQuery || '');
      const searchSpecs = extractQuerySpecs(searchQuery || '');

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

      let rankedProducts = fixedProducts;
      if (hasSpecs) {
        rankedProducts.sort((a, b) => b._specScore - a._specScore);

        const topScore = rankedProducts[0]?._specScore || 0;
        if (topScore > 0) {
          const matched = rankedProducts.filter(p => p._specScore > 0);
          if (matched.length > 0) {
            console.log(`[ToolService] Spec filter: ${matched.length}/${fixedProducts.length} matched (top: ${topScore})`);
            rankedProducts = matched;

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

      rankedProducts.forEach(p => delete p._specScore);

      console.log(`[ToolService] Returning ${Math.min(rankedProducts.length, MAX_PRODUCTS_TO_DISPLAY)} products`);

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
