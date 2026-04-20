/**
 * Tool Service — v2.3
 * Processes MCP tool responses (product search, cart updates)
 *
 * CHANGES (v2.3 — April 2026 CRITICAL PRODUCTION FIX):
 *   - FIXED: Relevance gate was dropping ALL products from successful Shopify
 *     semantic searches. Shopify's `search_catalog` uses vector/semantic search
 *     and returns conceptually related products that may not contain the
 *     literal query tokens in their title/description. The old v2.2 gate
 *     required at least one literal token match, which caused EVERY search to
 *     return zero when the query term wasn't in product text.
 *
 *     Confirmed in production logs (2026-04-20):
 *       user "AODD pump" → Shopify returns 10 pumps → gate drops all
 *         because no product contains literal "pump" or "aodd"
 *       user "proximity sensor" → Shopify returns 10 sensors → gate drops all
 *         because no product contains literal "proximity"
 *       fallback search "diaphragm" → 10 products returned → gate drops all
 *
 *     NEW BEHAVIOUR (v2.3):
 *       - If SOME products literally match → surface those first (prefer)
 *       - If NO products literally match → keep Shopify's semantic ordering
 *         (trust Shopify's ranker — better than returning nothing)
 *       - Spec-based SKU/dimension scoring is preserved and unchanged
 *
 *     Net effect: we never throw away a successful Shopify search result.
 *     We only re-rank when we can clearly identify exact matches.
 *
 * CHANGES (v2.2 — SUPERSEDED by v2.3):
 *   - Used searchQuery-only tokens for the gate. The gate itself was the
 *     real issue, so v2.3 replaces the logic rather than adjusting inputs.
 *
 * CHANGES (v2.1):
 *   - Accept multiple product-list shapes: { products }, { items }, { results }.
 *
 * CHANGES (v2.0):
 *   - Fixed false-positive SKU detection (24VDC, CAT5, RJ45, 25MM skipped)
 *   - Added blocklist for industrial spec tokens
 *   - Tightened SKU regex
 *   - Increased MAX_PRODUCTS_TO_DISPLAY from 8 to 12
 */

// ──────────────────────────────────────────────
// Blocklist: tokens that LOOK like SKUs but are
// actually voltage/cable/protocol/dimension strings.
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
// Stopwords used by the (now-soft) relevance gate.
// Words on this list are NOT treated as distinctive query tokens.
// ──────────────────────────────────────────────
const RELEVANCE_STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "for", "of", "with", "in", "on", "to", "me", "my",
  "show", "find", "need", "want", "do", "you", "have", "got", "some", "any", "please",
  "i", "is", "are", "can", "could", "would", "looking", "search",
  "product", "products", "part", "parts", "item", "items",
  // Generic product categories — pass through so browsing works
  "sensor", "sensors", "cable", "cables", "valve", "valves",
  "breaker", "breakers", "fuse", "fuses", "relay", "relays",
  "pump", "pumps", "motor", "motors", "drive", "drives",
  "switch", "switches", "light", "lights", "tool", "tools",
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
 * Extract distinctive tokens from a query for literal-match re-ranking.
 * Returns tokens that are ≥3 chars, alphanumeric, not stopwords, not blocklisted.
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

      // Accept multiple product-list keys and normalise into .products
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
      // v2.3: SOFT RELEVANCE GATE (PRODUCTION FIX)
      //
      // Shopify's search_catalog uses semantic/vector search — returned
      // products are conceptually related but may not contain query tokens
      // literally. The v2.2 hard gate dropped 10/10 products on every
      // semantic match, breaking search entirely.
      //
      // New rule: we RE-RANK (prefer literal matches first), never DROP.
      // If zero products contain any query token, we trust Shopify's
      // semantic ranking and pass the results through unchanged.
      // ─────────────────────────────────────────────
      const distinctiveTokens = extractDistinctiveTokens(searchQuery || userQuery || '');

      if (distinctiveTokens.length > 0) {
        const literalMatches = [];
        const semanticOnly = [];

        for (const p of responseData.products) {
          const hay = buildProductSearchText(p).toLowerCase();
          if (distinctiveTokens.some(t => hay.includes(t))) {
            literalMatches.push(p);
          } else {
            semanticOnly.push(p);
          }
        }

        if (literalMatches.length === 0) {
          // Shopify found semantic matches but none match literally.
          // TRUST Shopify's ranker — this is the v2.3 fix.
          console.log(
            `[ToolService] Soft gate: 0 literal matches for [${distinctiveTokens.join(', ')}], ` +
            `keeping all ${responseData.products.length} semantic results from Shopify`
          );
          // No change to responseData.products — pass through
        } else if (literalMatches.length < responseData.products.length) {
          // Mix of literal + semantic: surface literal first, then semantic
          console.log(
            `[ToolService] Soft gate: ${literalMatches.length} literal + ${semanticOnly.length} semantic ` +
            `(tokens: ${distinctiveTokens.join(', ')}) — literal first`
          );
          responseData.products = [...literalMatches, ...semanticOnly];
        }
        // else: all match literally, no reordering needed
      }

      // Spec extraction and scoring (SKU / dimension exact match re-ranking)
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

      // Spec-based exact-match re-ranking (only when we have specs to match on)
      if (hasSpecs) {
        const withScores = [...rankedProducts].sort((a, b) => b._specScore - a._specScore);
        const topScore = withScores[0]?._specScore || 0;

        if (topScore >= 100) {
          // Exact SKU match — return ONLY exact matches
          const exactMatches = withScores.filter(p => p._specScore >= 100);
          console.log(`[ToolService] Exact SKU match: returning ${exactMatches.length} products only`);
          rankedProducts = exactMatches;
        } else if (topScore > 0) {
          // Some spec matches — surface them first, keep rest as semantic fallback
          const matched = withScores.filter(p => p._specScore > 0);
          const unmatched = withScores.filter(p => p._specScore === 0);
          console.log(`[ToolService] Spec re-rank: ${matched.length} matched, ${unmatched.length} semantic (top score: ${topScore})`);
          rankedProducts = [...matched, ...unmatched];
        }
        // else: no spec matches — keep original order (from soft gate above)
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
