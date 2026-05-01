/**
 * Tool Service — v3.0
 * Processes MCP tool responses (product search, cart updates)
 *
 * =============================================================================
 * PATCH v3.0 — April 30, 2026 — MULTILINGUAL GATE FIX + SKU FIELD SCORING
 * =============================================================================
 *
 * ROOT CAUSE FOUND IN PRODUCTION LOGS (logs_1777545391484.log):
 *
 *   Bug 1 — The "solenoide" failure (confirmed in logs at 07:04:xx):
 *     User types "solenoide" (Spanish) → userQuery distinctive tokens = ["solenoide"]
 *     searchQuery = "5/2 solenoid valve" → tokens = [] (all stopwords)
 *     Combined gate tokens = ["solenoide"] (from userQuery only)
 *     Shopify returns 50 products containing "solenoid" (English)
 *     Gate requires "solenoide" → 0 matches → ALL 50 dropped
 *     Result: 8–12 wasted API calls, 10–13 second latency, 0 products shown
 *
 *   Bug 2 — The "only, first" failure (confirmed in logs at 07:05:xx):
 *     User message: "only the first 2 products are right ?"
 *     userQuery distinctive tokens = ["only", "first"] (conversational words)
 *     Same failure pattern as Bug 1 — drops 50 solenoid results
 *
 *   Bug 3 — The "pneumatic, other, available" case (also at 07:06:xx):
 *     "available" from user message was a gate token — but this one happened
 *     to work because the SEARCH query "5/2 solenoid valve pneumatic"
 *     had "pneumatic" which appears in product text.
 *     Lucky, not designed — same architecture flaw as Bug 1/2.
 *
 * FIX:
 *   The strict distinctive-token gate now uses ONLY the AI's searchQuery
 *   tokens — NOT the user's original message tokens. The AI always generates
 *   an English search query. The user's message may be in any language or
 *   contain conversational words that don't appear in product text.
 *   The inch-dimension gate still uses both (user intent for dimensions
 *   is clear regardless of language).
 *
 * ADDITIONAL FIX — SKU FIELD SCORING:
 *   scoreProductBySpecs() now distinguishes between:
 *     - Actual variant.sku field match  → score 200 (highest)
 *     - Product title match             → score 100
 *     - Description/tags match          → score 40  (was incorrectly 100)
 *   This prevents a product whose DESCRIPTION mentions "EC2016" from
 *   ranking equally with a product whose variant.sku IS "EC2016".
 *
 * =============================================================================
 * PREVIOUS VERSION HISTORY
 * =============================================================================
 *
 * v2.6 (April 30, 2026): Inch-dimension gate for "1 inch FRL" type queries.
 * v2.5 (April 2026): Distinctive-token gate uses union of search+user tokens.
 *      → This is what caused the solenoide bug. v3.0 reverts to search-only.
 * v2.4 (April 2026): Robust formatPrice().
 */

// ──────────────────────────────────────────────
// Blocklist: tokens that LOOK like SKUs but are
// actually voltage / cable / protocol strings.
// ──────────────────────────────────────────────
const SPEC_TOKEN_BLOCKLIST = new Set([
  '24VDC', '12VDC', '48VDC', '5VDC', '24VAC', '110VAC', '120VAC',
  '220VAC', '230VAC', '240VAC', '380VAC', '400VAC', '415VAC', '480VAC',
  '600VAC', '24V', '12V', '48V', '5V', '110V', '120V', '220V', '230V',
  '240V', '380V', '400V', '415V', '480V', '600V',
  'CAT5', 'CAT5E', 'CAT6', 'CAT6A', 'CAT7', 'CAT7A', 'CAT8',
  'RJ45', 'RJ11', 'RJ12', 'DB9', 'DB15', 'DB25',
  'RS232', 'RS485', 'RS422', 'IP67', 'IP68', 'IP65', 'IP54', 'IP55',
  'IP20', 'IP44', 'IEC61131', 'NEMA4', 'NEMA12',
  'AC1', 'DC1', 'AC3', 'DC3',
  'HTTP', 'HTTPS', 'HTML', 'JSON', 'UUID', 'MQTT', 'OPCUA',
  'MODBUS', 'TCPIP', 'PROFINET', 'PROFIBUS', 'CANOPEN', 'ETHERCAT',
  'USB', 'HDMI', 'DVI', 'VGA',
  'NPT', 'BSP', 'BSPT', 'BSPP',
]);

// ──────────────────────────────────────────────
// Stopwords for the relevance gate.
// These words are too generic for this industrial catalog to be
// "distinctive" — having them as gate tokens would either always
// pass (product contains "valve") or always fail ("solenoide").
// ──────────────────────────────────────────────
const RELEVANCE_STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "for", "of", "with", "in", "on", "to", "me", "my",
  "is", "are", "can", "could", "would", "should",
  "i", "you", "we", "they", "this", "that", "these", "those",
  "show", "find", "need", "want", "do", "have", "got", "some", "any", "please",
  "looking", "search", "get", "see", "browse", "tell", "give", "help",
  "right", "best", "good", "great", "new", "old", "also", "very", "really",
  "here", "there", "about", "what", "which", "how", "when", "where",
  "product", "products", "part", "parts", "item", "items",
  // Generic industrial/electrical categories
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
// Inch-dimension extraction (v2.6 — unchanged)
// ──────────────────────────────────────────────
function extractInchDimensions(query) {
  if (!query || typeof query !== 'string') return [];
  const out = new Set();
  const numPattern = '\\d+(?:-\\d+/\\d+|/\\d+|\\.\\d+)?';
  const reQuotes = new RegExp(`(${numPattern})\\s*"(?!\\w)`, 'g');
  const reInch = new RegExp(`(${numPattern})\\s*-?\\s*(?:inches|inch|in)\\b`, 'gi');
  let m;
  while ((m = reQuotes.exec(query)) !== null) out.add(m[1]);
  while ((m = reInch.exec(query)) !== null) {
    let v = m[1];
    if (/^\d+\.0+$/.test(v)) v = v.replace(/\.0+$/, '');
    out.add(v);
  }
  return [...out];
}

function buildInchMatchRegex(inchValue) {
  const escaped = String(inchValue).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const numLook = `(?<![\\d./])${escaped}(?![\\d./])`;
  const unit = `(?:\\s*"(?!\\w)|\\s*-?\\s*(?:inches|inch|in)\\b)`;
  return new RegExp(`${numLook}${unit}`, 'i');
}

function productMatchesInchDim(productHay, inchValue) {
  try {
    const re = buildInchMatchRegex(inchValue);
    return re.test(productHay);
  } catch (_e) {
    return true; // fail-safe: keep product
  }
}

// ──────────────────────────────────────────────
// Robust price formatter (v2.4 — unchanged)
// ──────────────────────────────────────────────
function extractAmount(val) {
  if (val === null || val === undefined) return null;
  if (typeof val === 'string') return val.trim() || null;
  if (typeof val === 'number') return String(val);
  if (typeof val === 'object') {
    if (val.amount !== undefined && val.amount !== null) return String(val.amount);
    if (val.value !== undefined && val.value !== null) return String(val.value);
    if (val.price !== undefined && val.price !== null) {
      const inner = val.price;
      if (typeof inner === 'string' || typeof inner === 'number') return String(inner);
    }
  }
  return null;
}

function extractCurrency(val, fallback = '') {
  if (!val) return fallback;
  if (typeof val === 'string') {
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

  if (p.price !== undefined && p.price !== null) {
    const amt = extractAmount(p.price);
    const curr = extractCurrency(p.price, p.currency || p.currency_code || p.currencyCode || '');
    if (amt) return curr ? `${amt} ${curr}` : amt;
  }

  if (p.price_range && typeof p.price_range === 'object') {
    const pr = p.price_range;
    const minAmt = extractAmount(pr.min);
    const maxAmt = extractAmount(pr.max);
    const currency =
      extractCurrency(pr.currency, '') ||
      extractCurrency(pr.min, '') ||
      extractCurrency(pr.max, '') ||
      extractCurrency(p.currency || p.currency_code, '') ||
      'USD';
    if (minAmt && maxAmt && minAmt !== maxAmt) return `${minAmt} - ${maxAmt} ${currency}`;
    if (minAmt) return `${minAmt} ${currency}`;
    if (maxAmt) return `${maxAmt} ${currency}`;
  }

  if (p.priceRange && typeof p.priceRange === 'object') {
    const minV = p.priceRange.minVariantPrice;
    if (minV) {
      const amt = extractAmount(minV);
      const curr = extractCurrency(minV);
      if (amt) return curr ? `${amt} ${curr}` : amt;
    }
  }

  if (Array.isArray(p.variants) && p.variants.length > 0) {
    for (const v of p.variants) {
      if (!v) continue;
      const amt = extractAmount(v.price);
      if (amt) {
        const curr = extractCurrency(v.price, v.currency || v.currency_code || v.currencyCode || '');
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
    if (val && !dimensions.includes(val)) dimensions.push(val);
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

/**
 * Score a product by how well it matches the extracted specs.
 *
 * v3.0 CHANGE: SKU scores are now tiered:
 *   - Actual variant.sku field match  → 200 (highest confidence)
 *   - Product title match             → 100 (good confidence)
 *   - Description/tags text match     → 40  (low confidence)
 *
 * Previously all text matches scored 100, meaning a product whose
 * DESCRIPTION mentions a SKU ranked the same as one whose actual
 * variant.sku IS that SKU. The new scoring fixes this.
 */
function scoreProductBySpecs(product, specs) {
  if (!specs.dimensions.length && !specs.skuPatterns.length && !specs.rawNumbers.length) return 0;

  let score = 0;
  const searchText = buildProductSearchText(product);
  const searchUpper = searchText.toUpperCase();
  const searchLower = searchText.toLowerCase();

  // Get actual SKU fields for high-confidence matching
  const productSku = String(product.sku || '').toUpperCase();
  const variantSkus = (product.variants || []).map(v => String(v.sku || '').toUpperCase());
  const titleUpper = String(product.title || '').toUpperCase();

  for (const sku of specs.skuPatterns) {
    const skuU = sku.toUpperCase();
    const skuN = skuU.replace(/[-\.\/]/g, '');
    const titleN = titleUpper.replace(/[-\.\/]/g, '');

    // Tier 1: Actual variant.sku field match (200 pts)
    if (variantSkus.some(s => s === skuU) || productSku === skuU) {
      score += 200; // Exact match on SKU field
    } else if (variantSkus.some(s => s.includes(skuU)) || productSku.includes(skuU)) {
      score += 180; // Contains match on SKU field
    } else if (
      variantSkus.some(s => s.replace(/[-\.\/]/g, '').includes(skuN)) ||
      productSku.replace(/[-\.\/]/g, '').includes(skuN)
    ) {
      score += 150; // Normalized match on SKU field (ignore separators)
    }
    // Tier 2: Product title match (100 pts)
    else if (titleUpper.includes(skuU) || titleN.includes(skuN)) {
      score += 100;
    }
    // Tier 3: Description/tags match (40 pts — low confidence)
    else if (searchUpper.includes(skuU)) {
      score += 40;
    } else {
      const searchN = searchUpper.replace(/[-\.\/]/g, '');
      if (searchN.includes(skuN)) {
        score += 30;
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
 *
 * v3.0 NOTE: This is now ONLY called with searchQuery (the AI's English
 * search string), NOT with userQuery. See processProductSearchResult() below.
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
      if (rawUrl.startsWith('http')) return rawUrl;
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

      const rawProducts =
        (Array.isArray(responseData?.products) && responseData.products) ||
        (Array.isArray(responseData?.items)    && responseData.items)    ||
        (Array.isArray(responseData?.results)  && responseData.results)  ||
        [];

      if (rawProducts.length === 0) return [];
      responseData.products = rawProducts;

      const resultCount = rawProducts.length;
      console.log(`[ToolService] Search returned ${resultCount} products`);

      // ─────────────────────────────────────────────
      // STRICT DISTINCTIVE-TOKEN GATE (v3.0 FIX)
      //
      // CRITICAL: Use ONLY searchQuery tokens — NOT userQuery tokens.
      //
      // Why: userQuery may be in Spanish ("solenoide"), French, etc.,
      // or contain conversational text ("only the first 2 are right?").
      // The AI always generates an English searchQuery. Gate on that.
      //
      // Example failure (now fixed):
      //   userQuery = "solenoide 5/2" → tokens = ["solenoide"]
      //   searchQuery = "5/2 solenoid valve" → tokens = [] (all stopwords)
      //   Old combined = ["solenoide"] → gate fails for all English products
      //   New: only searchQuery tokens = [] → gate skipped → correct results shown
      // ─────────────────────────────────────────────
      const distinctiveTokens = extractDistinctiveTokens(searchQuery || '');
      // NOTE: userQuery tokens deliberately excluded — see comment above

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
            `(tokens: ${distinctiveTokens.join(', ')})`
          );
          responseData.products = literalMatches;
        }
      }

      // ─────────────────────────────────────────────
      // INCH-DIMENSION GATE (v2.6 — unchanged)
      //
      // Keep using BOTH searchQuery and userQuery for inch dimensions.
      // Dimension intent is clear from user message regardless of language.
      // "1 inch FRL" in any language means the user wants 1-inch products.
      // ─────────────────────────────────────────────
      const inchDimsRaw = [
        ...extractInchDimensions(searchQuery || ''),
        ...extractInchDimensions(userQuery || ''),
      ];
      const inchDims = [...new Set(inchDimsRaw)];

      if (inchDims.length > 0) {
        const dimMatches = [];
        for (const p of responseData.products) {
          const hay = buildProductSearchText(p).toLowerCase();
          if (inchDims.some(d => productMatchesInchDim(hay, d))) {
            dimMatches.push(p);
          }
        }

        if (dimMatches.length === 0) {
          console.log(
            `[ToolService] Inch-dim gate: 0 of ${responseData.products.length} products ` +
            `match any of [${inchDims.map(d => `${d}"`).join(', ')}] — dropping all`
          );
          return [];
        }

        if (dimMatches.length < responseData.products.length) {
          console.log(
            `[ToolService] Inch-dim gate: kept ${dimMatches.length}/${responseData.products.length} ` +
            `matching [${inchDims.map(d => `${d}"`).join(', ')}]`
          );
          responseData.products = dimMatches;
        }
      }

      // ─────────────────────────────────────────────
      // SPEC EXTRACTION & RE-RANKING (v3.0: tiered SKU scoring)
      // ─────────────────────────────────────────────
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
        const priceText = formatPrice(p);
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
        const withScores = [...rankedProducts].sort((a, b) => b._specScore - a._specScore);
        const topScore = withScores[0]?._specScore || 0;

        if (topScore >= 150) {
          // Actual SKU field match (score 150+ = variant.sku contains the token)
          const exactSkuMatches = withScores.filter(p => p._specScore >= 150);
          console.log(`[ToolService] Exact SKU field match: returning ${exactSkuMatches.length} products (score ≥150)`);
          rankedProducts = exactSkuMatches;
        } else if (topScore >= 100) {
          // Title match is still reliable
          const titleMatches = withScores.filter(p => p._specScore >= 100);
          console.log(`[ToolService] Title SKU match: ${titleMatches.length} products (score ≥100)`);
          rankedProducts = titleMatches;
        } else if (topScore > 0) {
          // Description/tags match only — re-rank but don't filter
          const matched = withScores.filter(p => p._specScore > 0);
          const unmatched = withScores.filter(p => p._specScore === 0);
          console.log(`[ToolService] Spec re-rank (low confidence): ${matched.length} matched, ${unmatched.length} passthrough`);
          rankedProducts = [...matched, ...unmatched];
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

export default { createToolService };
