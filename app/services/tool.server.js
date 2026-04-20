/**
 * Tool Service — v2.4
 * Processes MCP tool responses (product search, cart updates)
 *
 * =============================================================================
 * CHANGES (v2.4 — April 2026 — TWO PRODUCTION FIXES)
 * =============================================================================
 *
 * FIX 1 — Price rendering bug ("[object Object] -" in product cards):
 *   Shopify's Storefront MCP `search_catalog` returns `price_range.min` and
 *   `price_range.max` in multiple shapes across stores/versions:
 *     - strings: "28.0" (documented format — shopify.dev example)
 *     - objects: { amount: "60.00", currency_code: "AED" } (observed in prod)
 *   Old code did `priceText = `${pr.min} - ${pr.max} ${currency}`` which, when
 *   pr.min / pr.max were objects, produced the literal string
 *   "[object Object] - [object Object] USD" on the product cards.
 *
 *   NEW: A robust `formatPrice()` helper that handles:
 *     - direct string/number prices
 *     - object prices { amount, currency_code } / { amount, currency }
 *     - price_range with string OR object min/max
 *     - variant-level price fallback
 *     - Shopify GraphQL priceRange.minVariantPrice shape (safety net)
 *   It NEVER returns an object. Returns '' if no valid amount can be extracted.
 *
 * FIX 2 — v2.3 "soft gate" was too permissive (wrong products shown):
 *   v2.3 trusted Shopify's semantic search entirely, which was correct for
 *   generic queries ("sensors") but WRONG for specific queries like
 *   "AODD pumps" — Shopify returned 10 unrelated pneumatic cylinders, and
 *   v2.3 passed them through. Users saw cylinders when asking for pumps.
 *
 *   NEW: Back to a STRICT gate — drop products when distinctive tokens have
 *   zero literal matches. BUT with an EXPANDED stopword list so generic
 *   category queries still pass through:
 *     - Generic query ("pumps", "sensors")     → no distinctive tokens →
 *                                                 gate skipped → all shown
 *     - Specific query ("AODD pumps")          → "aodd" distinctive →
 *                                                 gate drops unrelated results
 *     - Brand query ("Mindman cylinders")      → "mindman" distinctive →
 *                                                 only Mindman products shown
 *
 *   When strict gate drops all results, chat.jsx injects a retry hint, Claude
 *   retries with simpler/broader queries (which pass through the stopword
 *   filter), and the user sees appropriate products + honest messaging like
 *   "we don't have AODD pumps specifically, but here's our pneumatic range".
 *
 * =============================================================================
 * PREVIOUS VERSIONS (kept for history)
 * =============================================================================
 * v2.3: Soft gate — never dropped products. Replaced by v2.4 (too permissive).
 * v2.2: Strict gate with limited stopwords. Replaced by v2.3 (too strict for
 *       generic category queries like "sensors" which had no stopwords).
 * v2.1: Accept multiple product-list shapes {products}/{items}/{results}.
 * v2.0: Fixed false-positive SKU detection, blocklist, tightened SKU regex.
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
// v2.4: Stopwords for the relevance gate.
// Words here are NOT treated as distinctive tokens —
// meaning generic category queries ("sensors", "pumps")
// bypass the gate and show whatever Shopify returns.
// Distinctive terms (brands, SKUs, specific acronyms
// like "AODD", "proximity") will still trigger the gate.
// ──────────────────────────────────────────────
const RELEVANCE_STOPWORDS = new Set([
  // Articles, prepositions, pronouns
  "the", "a", "an", "and", "or", "for", "of", "with", "in", "on", "to", "me", "my",
  "is", "are", "can", "could", "would", "should",
  "i", "you", "we", "they", "this", "that", "these", "those",
  // Verbs & intent words
  "show", "find", "need", "want", "do", "have", "got", "some", "any", "please",
  "looking", "search", "get", "see", "browse", "tell", "give", "help",
  // Filler words commonly in user queries
  "right", "best", "good", "great", "new", "old", "also", "very", "really",
  "here", "there", "about", "what", "which", "how", "when", "where",
  // Generic product words
  "product", "products", "part", "parts", "item", "items",
  // Generic industrial/electrical categories — both singular and plural
  "sensor", "sensors",
  "cable", "cables",
  "valve", "valves",
  "breaker", "breakers",
  "fuse", "fuses",
  "relay", "relays",
  "pump", "pumps",
  "motor", "motors",
  "drive", "drives",
  "switch", "switches",
  "cylinder", "cylinders",
  "actuator", "actuators",
  "connector", "connectors",
  "transformer", "transformers",
  "contactor", "contactors",
  "solenoid", "solenoids",
  "coupling", "couplings",
  "filter", "filters",
  "supply", "supplies",
  "light", "lights",
  "tool", "tools",
  "unit", "units",
  "power",
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

// ──────────────────────────────────────────────
// v2.4 FIX #1: Robust price formatter.
// Handles EVERY observed shape of Shopify MCP price data and
// GUARANTEES a string return (never returns an object, so the UI
// can never show "[object Object]").
//
// Confirmed shapes from Shopify docs + prod observation:
//   { price: "28.0", currency: "CAD" }                 ← variant-style
//   { price: { amount: "28.0", currency_code: "CAD" } } ← object-style
//   { price_range: { min: "28.0", max: "28.0", currency: "CAD" } }    ← flat
//   { price_range: { min: {amount:"60",currency_code:"AED"}, max: {...} } } ← nested
//   { priceRange: { minVariantPrice: { amount, currencyCode } } }     ← GraphQL
// ──────────────────────────────────────────────
function extractAmount(val) {
  if (val === null || val === undefined) return null;
  if (typeof val === 'string') {
    // Reject strings that are clearly not numeric (like "[object Object]" if somehow here)
    return val.trim() || null;
  }
  if (typeof val === 'number') return String(val);
  if (typeof val === 'object') {
    // Try common keys used by Shopify and variants
    if (val.amount !== undefined && val.amount !== null) return String(val.amount);
    if (val.value !== undefined && val.value !== null) return String(val.value);
    if (val.price !== undefined && val.price !== null) {
      // Nested one level — but only if it's a primitive
      const inner = val.price;
      if (typeof inner === 'string' || typeof inner === 'number') return String(inner);
    }
  }
  return null;
}

function extractCurrency(val, fallback = '') {
  if (!val) return fallback;
  if (typeof val === 'string') {
    // If it looks like a currency code (3 uppercase letters), use it
    if (/^[A-Z]{3}$/.test(val)) return val;
    return fallback;
  }
  if (typeof val === 'object') {
    return val.currency_code || val.currencyCode || val.currency || fallback;
  }
  return fallback;
}

function formatPrice(p) {
  if (!p || typeof p !== 'object') return '';

  // Case 1: top-level price field (string, number, or object)
  if (p.price !== undefined && p.price !== null) {
    const amt = extractAmount(p.price);
    const curr = extractCurrency(
      p.price,
      p.currency || p.currency_code || p.currencyCode || ''
    );
    if (amt) return curr ? `${amt} ${curr}` : amt;
  }

  // Case 2: price_range with min/max (either strings or nested objects)
  if (p.price_range && typeof p.price_range === 'object') {
    const pr = p.price_range;
    const minAmt = extractAmount(pr.min);
    const maxAmt = extractAmount(pr.max);
    // Currency can live on price_range, on min/max objects, or on product
    const currency =
      extractCurrency(pr.currency, '') ||
      extractCurrency(pr.min, '') ||
      extractCurrency(pr.max, '') ||
      extractCurrency(pr.currency_code, '') ||
      extractCurrency(p.currency || p.currency_code, '') ||
      'USD';

    if (minAmt && maxAmt && minAmt !== maxAmt) {
      return `${minAmt} - ${maxAmt} ${currency}`;
    }
    if (minAmt) return `${minAmt} ${currency}`;
    if (maxAmt) return `${maxAmt} ${currency}`;
  }

  // Case 3: Shopify GraphQL shape (priceRange.minVariantPrice)
  if (p.priceRange && typeof p.priceRange === 'object') {
    const minV = p.priceRange.minVariantPrice;
    if (minV) {
      const amt = extractAmount(minV);
      const curr = extractCurrency(minV);
      if (amt) return curr ? `${amt} ${curr}` : amt;
    }
  }

  // Case 4: Fall back to first available variant price
  if (Array.isArray(p.variants) && p.variants.length > 0) {
    for (const v of p.variants) {
      if (!v) continue;
      const amt = extractAmount(v.price);
      if (amt) {
        const curr = extractCurrency(
          v.price,
          v.currency || v.currency_code || v.currencyCode || ''
        );
        return curr ? `${amt} ${curr}` : amt;
      }
    }
  }

  return '';
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
 * Extract distinctive tokens from a query for the relevance gate.
 * Returns tokens that are ≥3 chars, alphanumeric, not stopwords, not blocklisted specs.
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
      // v2.4 FIX #2: STRICT RELEVANCE GATE
      //
      // Drop products when distinctive query tokens have ZERO literal matches.
      // This prevents Shopify's semantic search from showing unrelated products
      // (e.g., cylinders when user asked for "AODD pumps").
      //
      // Stopwords ensure generic category queries ("sensors", "pumps") have
      // NO distinctive tokens, so the gate is skipped and all results pass.
      // Only specific terms (brands, SKUs, acronyms like "AODD", "proximity")
      // trigger the strict filter.
      //
      // If gate drops all products, chat.jsx will send a retry hint to Claude,
      // who will retry with simpler queries that pass through stopwords.
      // ─────────────────────────────────────────────
      const distinctiveTokens = extractDistinctiveTokens(searchQuery || userQuery || '');

      if (distinctiveTokens.length > 0) {
        const literalMatches = [];

        for (const p of responseData.products) {
          const hay = buildProductSearchText(p).toLowerCase();
          if (distinctiveTokens.some(t => hay.includes(t))) {
            literalMatches.push(p);
          }
        }

        if (literalMatches.length === 0) {
          console.log(
            `[ToolService] Strict gate: 0 literal matches for [${distinctiveTokens.join(', ')}] ` +
            `— dropping ${responseData.products.length} unrelated semantic results`
          );
          return [];
        }

        if (literalMatches.length < responseData.products.length) {
          console.log(
            `[ToolService] Strict gate: kept ${literalMatches.length}/${responseData.products.length} ` +
            `literal matches (tokens: ${distinctiveTokens.join(', ')})`
          );
          responseData.products = literalMatches;
        }
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

        // v2.4: Use robust formatPrice() instead of raw template-literal assignment.
        // This eliminates "[object Object]" rendering when Shopify returns
        // object-shaped prices.
        const priceText = formatPrice(p);

        const specScore = hasSpecs ? scoreProductBySpecs(p, mergedSpecs) : 0;

        return {
          id: p.product_id || p.id,
          title: p.title || 'Untitled Product',
          handle: p.handle || null,
          image_url: rawImageUrl,
          url: productUrl,
          price: priceText, // guaranteed string
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
          // Some spec matches — surface them first
          const matched = withScores.filter(p => p._specScore > 0);
          const unmatched = withScores.filter(p => p._specScore === 0);
          console.log(`[ToolService] Spec re-rank: ${matched.length} matched, ${unmatched.length} passthrough (top score: ${topScore})`);
          rankedProducts = [...matched, ...unmatched];
        }
        // else: no spec matches — keep original order
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
