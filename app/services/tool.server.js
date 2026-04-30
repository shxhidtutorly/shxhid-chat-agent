/**
 * Tool Service — v2.6
 * Processes MCP tool responses (product search, cart updates)
 *
 * =============================================================================
 * CHANGES (v2.6 — April 30, 2026 — INCH-DIMENSION RELEVANCE GATE)
 * =============================================================================
 *
 * BUG (production logs lines 928–942 of logs_1777525013235.log):
 *   User: "FRL 1 inch"
 *     1. MCP semantic search → 10 unrelated results, v2.5 distinctive-token
 *        gate drops them ([frl, inch, inc] not in any title).
 *     2. Direct Storefront API "FRL 1 inch" → 0 products
 *        (Shopify search treats `inch` as a literal token).
 *     3. Direct Storefront API "FRL 1 inc" → 0 products.
 *     4. Direct Storefront API "FRL" → 21 products. None of them are
 *        filtered for "1 inch", because:
 *          - The v2.5 gate runs on distinctive tokens [frl] only — every
 *            FRL product passes literal-match.
 *          - extractQuerySpecs() only recognises `Nmm` / `Ncm` units, so
 *            the inch value is never extracted into specs.dimensions.
 *          - scoreProductBySpecs() therefore returns 0 for every product,
 *            no re-ranking happens, and the first 12 generic FRLs are
 *            shown to the user.
 *     5. User sees 12 FRL products, none of which are 1-inch — exactly the
 *        complaint in the screenshots.
 *
 * Same shape applies to "AODD pump 2 inch", "valve 1/2 inch", etc.
 *
 * FIX:
 *   Add a dedicated inch-dimension gate that runs AFTER the v2.5 distinctive-
 *   token gate but BEFORE the spec re-ranker. When the user's query (either
 *   the AI-narrowed searchQuery OR the original userQuery) contains an inch
 *   dimension like `1 inch`, `1"`, `1/2"`, `0.5 in`, or `1-inch`, the gate:
 *
 *     - Extracts the dimension values (e.g. ["1"], ["1/2", "3/4"]).
 *     - Filters products to only those whose title/description/SKU/variant
 *       text contains a matching inch dimension with proper word boundaries
 *       (so "1\"" doesn't match "11\"" and "1/2\"" doesn't match "1\"").
 *     - If zero products match, returns [] so chat.jsx fires the retry hint
 *       and Claude tries a different search strategy.
 *     - If some products match, keeps only those.
 *
 *   Queries WITHOUT inch dimensions are unaffected — the gate is skipped.
 *
 *   Behaviour matrix:
 *     - "FRL 1 inch" + AI fallback "FRL" + 21 generic results
 *         → inch dim "1" extracted from userQuery
 *         → 0 of 21 contain literal `1"` / `1 inch`
 *         → return [] → retry hint fires
 *     - "FRL 1 inch" + 4 of 21 do contain `1"` in the title
 *         → return only those 4
 *     - "show me FRLs" (no inch dim)
 *         → gate skipped → original v2.5 behaviour
 *     - "AODD pump 1/2 inch" + 3 of 5 contain `1/2"`
 *         → return only those 3
 *
 *   No existing behaviour changes for non-inch queries. The v2.5 strict
 *   distinctive-token gate, the spec re-ranker, and the exact-SKU short-
 *   circuit all run unchanged.
 *
 * =============================================================================
 * PREVIOUS VERSION HISTORY
 * =============================================================================
 *
 * v2.5 (April 2026 — relevance-gate leak fix): Distinctive-token gate now
 *      uses union of tokens from BOTH searchQuery and userQuery, so user
 *      intent ("aodd", "schneider") stays enforced when the AI falls back
 *      to a stopword query like "pumps" or "breaker".
 *
 * v2.4 (April 2026): Robust formatPrice() — handles every observed Shopify
 *      MCP price shape (string, object, price_range with nested objects,
 *      GraphQL minVariantPrice). Fixes "[object Object]" rendering in cards.
 *      Re-introduced strict gate after v2.3 was too permissive.
 *
 * v2.3: Soft gate (kept everything Shopify returned). Replaced — too
 *      permissive for specific queries.
 * v2.2: Strict gate without expanded stopwords. Replaced — too aggressive
 *      on generic category queries.
 * v2.1: Accept multiple product-list response shapes.
 * v2.0: SKU regex tightening + spec blocklist.
 */

// ──────────────────────────────────────────────
// Blocklist: tokens that LOOK like SKUs but are
// actually voltage / cable / protocol / dimension strings.
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
// v2.4: Stopwords for the relevance gate. See header for rationale.
// "inch" is NOT in this list — it IS distinctive in user intent ("1 inch"),
// but inch *matching* is now handled by the dedicated inch-dim gate (v2.6),
// not the general literal-token gate, so leaving it here is harmless.
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
// v2.6: Inch-dimension extraction & matching
//
// extractInchDimensions("FRL 1 inch")        → ["1"]
// extractInchDimensions('1/2" valve')        → ["1/2"]
// extractInchDimensions("0.5 in pipe")       → ["0.5"]
// extractInchDimensions("show 3/4-inch")     → ["3/4"]
// extractInchDimensions("12mm pipe")         → []   (not inch-flavoured)
// extractInchDimensions("11 employees")      → []   (no inch unit)
// ──────────────────────────────────────────────
function extractInchDimensions(query) {
  if (!query || typeof query !== 'string') return [];
  const out = new Set();

  // Number forms supported (in priority order — first alternative wins):
  //   - compound fraction:    `1-1/4`     (industrial pipe sizes)
  //   - simple fraction:      `1/2`, `3/4`
  //   - decimal:              `0.5`, `1.5`
  //   - integer:              `1`, `12`
  // Note: a simple `-` followed by digits is NOT a compound — it's just a
  // dash before the unit, as in "1-inch".
  const numPattern = '\\d+(?:-\\d+/\\d+|/\\d+|\\.\\d+)?';

  //  Form 1: NUMBER followed by `"` (and `"` must NOT be followed by an
  //  alphanumeric — prevents matching inside compound words like `1"x`).
  const reQuotes = new RegExp(`(${numPattern})\\s*"(?!\\w)`, 'g');

  //  Form 2: NUMBER followed by `inch`/`inches`/`in` with optional dash/space.
  //  Word boundary on the unit prevents matching `inc` (as in "Acme Inc.").
  const reInch = new RegExp(`(${numPattern})\\s*-?\\s*(?:inches|inch|in)\\b`, 'gi');

  let m;
  while ((m = reQuotes.exec(query)) !== null) out.add(m[1]);
  while ((m = reInch.exec(query)) !== null) {
    // Drop trailing zero on whole-number decimals so "1.0 inch" → "1"
    let v = m[1];
    if (/^\d+\.0+$/.test(v)) v = v.replace(/\.0+$/, '');
    out.add(v);
  }
  return [...out];
}

/**
 * Build a regex that matches a given inch value in product text with proper
 * word boundaries. Prevents:
 *   - "1\"" matching "11\""    (preceding digit blocks it)
 *   - "1\"" matching "1/2\""   (preceding `/` and trailing `/digit` blocks it)
 *   - "1 inch" matching "11 inch"
 */
function buildInchMatchRegex(inchValue) {
  // Escape regex specials in the inchValue (mainly for `/` and `.` in fractions/decimals)
  const escaped = String(inchValue).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // Negative left-context: must not be preceded by a digit, dot, or `/`
  // (so "11" doesn't match "1", and "1/2" doesn't match "1").
  // Negative right-context for the number: must not be followed by another
  // digit/dot/slash that would make this a different number.
  // Then require a unit: `"`, `in`, `inch`, `inches`, possibly with hyphen/space.
  const numLook = `(?<![\\d./])${escaped}(?![\\d./])`;
  const unit = `(?:\\s*"(?!\\w)|\\s*-?\\s*(?:inches|inch|in)\\b)`;
  return new RegExp(`${numLook}${unit}`, 'i');
}

function productMatchesInchDim(productHay, inchValue) {
  try {
    const re = buildInchMatchRegex(inchValue);
    return re.test(productHay);
  } catch (_e) {
    // If the value contained something that broke regex compilation, fail safe
    // (keep the product) rather than dropping legitimate results.
    return true;
  }
}

// ──────────────────────────────────────────────
// v2.4: Robust price formatter. See header for rationale.
// Handles EVERY observed shape of Shopify MCP price data and GUARANTEES a
// string return (never returns an object, so the UI can never show
// "[object Object]").
// ──────────────────────────────────────────────
function extractAmount(val) {
  if (val === null || val === undefined) return null;
  if (typeof val === 'string') {
    return val.trim() || null;
  }
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
    const curr = extractCurrency(
      p.price,
      p.currency || p.currency_code || p.currencyCode || ''
    );
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
      extractCurrency(pr.currency_code, '') ||
      extractCurrency(p.currency || p.currency_code, '') ||
      'USD';

    if (minAmt && maxAmt && minAmt !== maxAmt) {
      return `${minAmt} - ${maxAmt} ${currency}`;
    }
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
      // STRICT DISTINCTIVE-TOKEN GATE (v2.5)
      // ─────────────────────────────────────────────
      const searchTokens = extractDistinctiveTokens(searchQuery || '');
      const userTokens = extractDistinctiveTokens(userQuery || '');
      const distinctiveTokens = [...new Set([...searchTokens, ...userTokens])];

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

      // ─────────────────────────────────────────────
      // INCH-DIMENSION GATE (v2.6 — NEW)
      //
      // When user asked for an explicit inch dimension ("1 inch", "1/2\"",
      // etc.), drop products whose haystack does not contain that dimension.
      // Uses BOTH searchQuery and userQuery so dimensions stay enforced even
      // when the AI fell back to a dimensionless query like "FRL".
      //
      // If the gate empties the list, return [] so chat.jsx fires the retry
      // hint and Claude tries a different search angle.
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
      // SPEC EXTRACTION & RE-RANKING
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

        if (topScore >= 100) {
          const exactMatches = withScores.filter(p => p._specScore >= 100);
          console.log(`[ToolService] Exact SKU match: returning ${exactMatches.length} products only`);
          rankedProducts = exactMatches;
        } else if (topScore > 0) {
          const matched = withScores.filter(p => p._specScore > 0);
          const unmatched = withScores.filter(p => p._specScore === 0);
          console.log(`[ToolService] Spec re-rank: ${matched.length} matched, ${unmatched.length} passthrough (top score: ${topScore})`);
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

export default {
  createToolService,
};
