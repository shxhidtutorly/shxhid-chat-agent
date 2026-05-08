/**
 * Tool Service — v4.0
 * Processes MCP tool responses (product search, cart updates)
 *
 * =============================================================================
 * v4.0 — May 7, 2026 — COMPLETE SEARCH ACCURACY OVERHAUL
 * =============================================================================
 *
 * FIXES (from QA test report May 7, 2026):
 *
 * 1. IMAGE EXTRACTION — FIXED
 *    Root cause: MCP search_catalog UCP returns images ONLY in media[] array
 *    with shape: media[0].image.url (NOT media[0].preview_image.src)
 *    Confirmed from production logs:
 *      "all_keys":"id, title, description, url, price_range, variants, options, media, tags"
 *      "media":"array[1]"
 *    Fix: Added media[].image.url to the extraction chain, moved media[] higher
 *    in priority since it's the ONLY field populated by this MCP version.
 *
 * 2. STRICT GATE — "inch" KILLED ALL RESULTS
 *    Root cause: "inch" is 4 chars, not in RELEVANCE_STOPWORDS, not in
 *    SPEC_TOKEN_BLOCKLIST, so it became a "distinctive token" that had to
 *    appear in product text. But products use ", ″, in, or metric equivalents.
 *    Fix: Added measurement units (inch, inches, mm, cm, etc.) to stopwords.
 *    Also added "bar", "psi", "way", "pole", "phase" etc.
 *
 * 3. INCH-DIMENSION GATE — TOO AGGRESSIVE
 *    Root cause: Gate required exact "1"" pattern in product text. Products
 *    often list dimensions differently: "DN25", "G1", "BSP 1", "25.4mm".
 *    Fix: Inch-dim gate now RELAXES instead of DROPS when zero matches.
 *    If no products match the inch dimension, we return ALL products rather
 *    than returning ZERO. The products were already filtered by the search
 *    query — the dimension is a nice-to-have filter, not a hard gate.
 *
 * 4. EXACT-SKU RANKING — EXACT MATCH WAS POSITION 2
 *    Root cause: scoreProductBySpecs() scored variant SKU match at 200 and
 *    title match at 100, but both were above the 150 threshold, so
 *    no re-ordering happened within the ≥150 tier.
 *    Fix: Added explicit exact-match-first sort within each tier.
 *    Products with exact variant SKU match (score 200) now sort before
 *    products with partial SKU match (score 180/150).
 *
 * 5. CATEGORY DRIFT — "pneumatic cylinder" returned accessories
 *    Root cause: MCP search returns everything with "pneumatic" in title,
 *    including mounting brackets and locknuts. No category filtering.
 *    Fix: Added lightweight category-coherence check: if the search query
 *    contains a clear product type noun, products whose titles don't
 *    contain that noun OR a known synonym are deprioritized (sorted to end).
 *
 * =============================================================================
 * PREVIOUS VERSION HISTORY
 * =============================================================================
 * v3.2 (May 1, 2026): Exhaustive image URL extraction (partial — completed in v4.0)
 * v3.1 (May 1, 2026): "catalog"/"query" in stopwords
 * v3.0 (April 30, 2026): Multilingual gate fix + SKU field scoring
 * v2.6 (April 30, 2026): Inch-dimension gate
 * v2.5 (April 2026): Distinctive-token gate
 * v2.4 (April 2026): Robust formatPrice()
 */

const SPEC_TOKEN_BLOCKLIST = new Set([
  "24VDC", "12VDC", "48VDC", "5VDC", "24VAC", "110VAC", "120VAC",
  "220VAC", "230VAC", "240VAC", "380VAC", "400VAC", "415VAC", "480VAC",
  "600VAC", "24V", "12V", "48V", "5V", "110V", "120V", "220V", "230V",
  "240V", "380V", "400V", "415V", "480V", "600V",
  "CAT5", "CAT5E", "CAT6", "CAT6A", "CAT7", "CAT7A", "CAT8",
  "RJ45", "RJ11", "RJ12", "DB9", "DB15", "DB25",
  "RS232", "RS485", "RS422", "IP67", "IP68", "IP65", "IP54", "IP55",
  "IP20", "IP44", "IEC61131", "NEMA4", "NEMA12",
  "AC1", "DC1", "AC3", "DC3",
  "HTTP", "HTTPS", "HTML", "JSON", "UUID", "MQTT", "OPCUA",
  "MODBUS", "TCPIP", "PROFINET", "PROFIBUS", "CANOPEN", "ETHERCAT",
  "USB", "HDMI", "DVI", "VGA",
  "NPT", "BSP", "BSPT", "BSPP",
]);

const RELEVANCE_STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "for", "of", "with", "in", "on", "to", "me", "my",
  "is", "are", "can", "could", "would", "should",
  "i", "you", "we", "they", "this", "that", "these", "those",
  "show", "find", "need", "want", "do", "have", "got", "some", "any", "please",
  "looking", "search", "get", "see", "browse", "tell", "give", "help",
  "right", "best", "good", "great", "new", "old", "also", "very", "really",
  "here", "there", "about", "what", "which", "how", "when", "where",
  "product", "products", "part", "parts", "item", "items",
  // v3.1/v3.2: schema words that leak from JSON.stringify(toolArgs)
  "catalog", "query",
  // v4.0: measurement units — these are specs, not distinctive product identifiers.
  // "inch" was killing ALL results in the strict gate because products don't always
  // contain the literal word "inch" (they use ", ″, in, DN, or metric equivalents).
  "inch", "inches",
  "millimeter", "millimeters", "centimeter", "centimeters",
  "meter", "meters",
  "bar", "psi", "mpa",
  "amp", "amps", "ampere", "amperes",
  "volt", "volts", "voltage",
  "watt", "watts",
  "ohm", "ohms",
  "degree", "degrees",
  "bore", "stroke", "diameter", "length", "width", "height", "size", "thick", "thickness",
  // v4.0: generic industrial qualifiers that match too broadly
  "way", "ways",      // "2 way valve" — "way" matches everything
  "pole", "poles",    // "4 pole breaker" — same issue
  "phase",            // "3 phase" — same issue
  "type", "series", "model", "range", "class", "grade", "rated",
  "industrial", "automation", "electrical", "professional", "commercial",
  "double", "single", "acting", "heavy", "duty", "high", "low", "medium",
  // Generic industrial/electrical categories (keep — they appear in product text
  // but are stopwords as gate tokens because they match everything)
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
  "coil", "coils",
  "bracket", "brackets",
  "mount", "mounting",
  "plate", "plates",
]);

function isBlocklistedToken(token) {
  const upper = token.toUpperCase();
  if (SPEC_TOKEN_BLOCKLIST.has(upper)) return true;
  // Electrical/spec units
  if (/^\d+MM$/i.test(token)) return true;
  if (/^\d+CM$/i.test(token)) return true;
  if (/^\d+[AVWW]$/i.test(token)) return true;
  if (/^IP\d{2}$/i.test(token)) return true;
  // Inch/foot dimension tokens
  if (/^\d+(?:\.\d+)?(?:INCH|INCHES|IN|FT|FEET|FOOT)$/i.test(token)) return true;
  return false;
}

function extractInchDimensions(query) {
  if (!query || typeof query !== "string") return [];
  const out = new Set();
  const numPattern = "\\d+(?:-\\d+/\\d+|/\\d+|\\.\\d+)?";
  const reQuotes = new RegExp(`(${numPattern})\\s*"(?!\\w)`, "g");
  const reInch = new RegExp(`(${numPattern})\\s*-?\\s*(?:inches|inch|in)\\b`, "gi");
  let m;
  while ((m = reQuotes.exec(query)) !== null) out.add(m[1]);
  while ((m = reInch.exec(query)) !== null) {
    let v = m[1];
    if (/^\d+\.0+$/.test(v)) v = v.replace(/\.0+$/, "");
    out.add(v);
  }
  return [...out];
}

function buildInchMatchRegex(inchValue) {
  const escaped = String(inchValue).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const numLook = `(?<![\\d./])${escaped}(?![\\d./])`;
  const unit = `(?:\\s*"(?!\\w)|\\s*-?\\s*(?:inches|inch|in)\\b)`;
  return new RegExp(`${numLook}${unit}`, "i");
}

function productMatchesInchDim(productHay, inchValue) {
  try { return buildInchMatchRegex(inchValue).test(productHay); } catch (_e) { return true; }
}

function extractAmount(val) {
  if (val === null || val === undefined) return null;
  if (typeof val === "string") return val.trim() || null;
  if (typeof val === "number") return String(val);
  if (typeof val === "object") {
    if (val.amount !== undefined && val.amount !== null) return String(val.amount);
    if (val.value !== undefined && val.value !== null) return String(val.value);
    if (val.price !== undefined && val.price !== null) {
      const inner = val.price;
      if (typeof inner === "string" || typeof inner === "number") return String(inner);
    }
  }
  return null;
}

function extractCurrency(val, fallback = "") {
  if (!val) return fallback;
  if (typeof val === "string") return /^[A-Z]{3}$/.test(val) ? val : fallback;
  if (typeof val === "object") return val.currency_code || val.currencyCode || val.currency || fallback;
  return fallback;
}

function formatPrice(p) {
  if (!p || typeof p !== "object") return "";

  if (p.price !== undefined && p.price !== null) {
    const amt = extractAmount(p.price);
    const curr = extractCurrency(p.price, p.currency || p.currency_code || p.currencyCode || "");
    if (amt) return curr ? `${amt} ${curr}` : amt;
  }

  if (p.price_range && typeof p.price_range === "object") {
    const pr = p.price_range;
    const minAmt = extractAmount(pr.min);
    const maxAmt = extractAmount(pr.max);
    const currency = extractCurrency(pr.currency, "") || extractCurrency(pr.min, "") || extractCurrency(pr.max, "") || extractCurrency(p.currency || p.currency_code, "") || "USD";
    if (minAmt && maxAmt && minAmt !== maxAmt) return `${minAmt} - ${maxAmt} ${currency}`;
    if (minAmt) return `${minAmt} ${currency}`;
    if (maxAmt) return `${maxAmt} ${currency}`;
  }

  if (p.priceRange && typeof p.priceRange === "object") {
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
        const curr = extractCurrency(v.price, v.currency || v.currency_code || v.currencyCode || "");
        return curr ? `${amt} ${curr}` : amt;
      }
    }
  }

  return "";
}

function extractQuerySpecs(query) {
  if (!query || typeof query !== "string") return { dimensions: [], skuPatterns: [], rawNumbers: [] };

  const dimRegex = /(\d+(?:\.\d+)?)\s*(?:mm|cm)\b/gi;
  const dimensions = [];
  let m;
  while ((m = dimRegex.exec(query)) !== null) dimensions.push(parseFloat(m[1]));

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
  while ((m = ratingRegex.exec(query)) !== null) rawNumbers.push(parseFloat(m[1]));

  return { dimensions, skuPatterns, rawNumbers };
}

function buildProductSearchText(product) {
  const parts = [
    product.title || "",
    product.description || "",
    product.sku || "",
    product.vendor || "",
    product.product_type || "",
  ];

  if (Array.isArray(product.variants)) {
    for (const v of product.variants) {
      parts.push(v.title || "", v.sku || "", v.option1 || "", v.option2 || "", v.option3 || "");
    }
  }

  if (Array.isArray(product.tags)) {
    parts.push(...product.tags);
  } else if (typeof product.tags === "string") {
    parts.push(product.tags);
  }

  return parts.join(" ");
}

function scoreProductBySpecs(product, specs) {
  if (!specs.dimensions.length && !specs.skuPatterns.length && !specs.rawNumbers.length) return 0;

  let score = 0;
  const searchText = buildProductSearchText(product);
  const searchUpper = searchText.toUpperCase();
  const searchLower = searchText.toLowerCase();
  const productSku = String(product.sku || "").toUpperCase();
  const variantSkus = (product.variants || []).map((v) => String(v.sku || "").toUpperCase());
  const titleUpper = String(product.title || "").toUpperCase();

  for (const sku of specs.skuPatterns) {
    const skuU = sku.toUpperCase();
    const skuN = skuU.replace(/[-\.\/]/g, "");
    const titleN = titleUpper.replace(/[-\.\/]/g, "");

    // v4.0: Higher score for EXACT match (full string equals) vs CONTAINS match
    if (variantSkus.some((s) => s === skuU) || productSku === skuU) score += 250;      // exact field match
    else if (variantSkus.some((s) => s.includes(skuU)) || productSku.includes(skuU)) score += 200; // contains
    else if (variantSkus.some((s) => s.replace(/[-\.\/]/g, "").includes(skuN)) || productSku.replace(/[-\.\/]/g, "").includes(skuN)) score += 150;
    else if (titleUpper.includes(skuU) || titleN.includes(skuN)) score += 100;
    else if (searchUpper.includes(skuU)) score += 40;
    else if (searchUpper.replace(/[-\.\/]/g, "").includes(skuN)) score += 30;
  }

  for (const dim of specs.dimensions) {
    const dimStr = String(dim);
    if (searchLower.includes(dimStr + "mm") || searchLower.includes(dimStr + " mm")) score += 25;
    else if (searchLower.includes(dimStr + "cm") || searchLower.includes(dimStr + " cm")) score += 25;
    else if (searchText.includes(dimStr)) score += 5;
  }

  for (const num of specs.rawNumbers) {
    const numStr = String(num);
    if (searchLower.includes(numStr + "a") || searchLower.includes(numStr + " a")) score += 10;
  }

  return score;
}

function extractDistinctiveTokens(query) {
  if (!query || typeof query !== "string") return [];
  return query
    .toLowerCase()
    .split(/[^a-z0-9]+/i)
    .filter((t) => t.length >= 3 && !RELEVANCE_STOPWORDS.has(t) && !isBlocklistedToken(t));
}

/**
 * Extract a clean plain-text description from a product object.
 */
function extractDescription(product) {
  const raw = product.description;

  if (typeof raw === "string") {
    return raw.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().substring(0, 500);
  }

  if (raw && typeof raw === "object") {
    const val = raw.value || raw.text || raw.html || raw.content || raw.body || "";
    if (typeof val === "string") {
      return val.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().substring(0, 500);
    }
  }

  const html = product.descriptionHtml || product.body_html || product.bodyHtml || "";
  if (typeof html === "string" && html) {
    return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().substring(0, 500);
  }

  return "";
}

/**
 * Extract a valid image URL from a product object.
 *
 * v4.0: REORDERED based on production log evidence.
 * Production logs confirm: all_keys = "id, title, description, url, price_range, variants, options, media, tags"
 * The ONLY image field populated is media[] — so we check it FIRST.
 *
 * media[] items can have these shapes (from Shopify UCP/Storefront API):
 *   - { image: { url: "https://..." } }           ← most common in search_catalog UCP
 *   - { preview_image: { src: "https://..." } }    ← older MCP versions
 *   - { url: "https://..." }                       ← direct media URL
 *   - { src: "https://..." }                       ← Admin API shape
 */
function extractImageUrl(product) {
  // ── media array (FIRST — this is what the current MCP returns) ────────
  if (Array.isArray(product.media) && product.media.length > 0) {
    for (const m of product.media) {
      // search_catalog UCP shape: media[].image.url
      if (typeof m?.image?.url === "string" && m.image.url.startsWith("http")) return m.image.url;
      if (typeof m?.image?.src === "string" && m.image.src.startsWith("http")) return m.image.src;
      // Older MCP shape: media[].preview_image.src
      if (typeof m?.preview_image?.src === "string" && m.preview_image.src.startsWith("http")) return m.preview_image.src;
      if (typeof m?.preview_image?.url === "string" && m.preview_image.url.startsWith("http")) return m.preview_image.url;
      // Direct URL on media item
      if (typeof m?.url === "string" && m.url.startsWith("http")) return m.url;
      if (typeof m?.src === "string" && m.src.startsWith("http")) return m.src;
    }
  }

  // ── featured_media (UCP shape) ───────────────────────────────────────
  if (product.featured_media) {
    if (typeof product.featured_media?.image?.url === "string" && product.featured_media.image.url.startsWith("http")) return product.featured_media.image.url;
    if (typeof product.featured_media?.preview_image?.src === "string" && product.featured_media.preview_image.src.startsWith("http")) return product.featured_media.preview_image.src;
    if (typeof product.featured_media?.preview_image?.url === "string" && product.featured_media.preview_image.url.startsWith("http")) return product.featured_media.preview_image.url;
    if (typeof product.featured_media?.src === "string" && product.featured_media.src.startsWith("http")) return product.featured_media.src;
    if (typeof product.featured_media?.url === "string" && product.featured_media.url.startsWith("http")) return product.featured_media.url;
  }

  // ── Direct string URL fields ──────────────────────────────────────────
  if (typeof product.image_url === "string" && product.image_url.startsWith("http")) return product.image_url;
  if (typeof product.thumbnail_url === "string" && product.thumbnail_url.startsWith("http")) return product.thumbnail_url;
  if (typeof product.thumbnail === "string" && product.thumbnail.startsWith("http")) return product.thumbnail;

  // ── featured_image ────────────────────────────────────────────────────
  if (product.featured_image) {
    if (typeof product.featured_image === "string" && product.featured_image.startsWith("http")) return product.featured_image;
    if (typeof product.featured_image?.url === "string" && product.featured_image.url.startsWith("http")) return product.featured_image.url;
    if (typeof product.featured_image?.src === "string" && product.featured_image.src.startsWith("http")) return product.featured_image.src;
  }

  // ── featuredImage (GraphQL camelCase) ─────────────────────────────────
  if (product.featuredImage) {
    if (typeof product.featuredImage?.url === "string" && product.featuredImage.url.startsWith("http")) return product.featuredImage.url;
    if (typeof product.featuredImage?.src === "string" && product.featuredImage.src.startsWith("http")) return product.featuredImage.src;
    if (typeof product.featuredImage === "string" && product.featuredImage.startsWith("http")) return product.featuredImage;
  }

  // ── image (single object or string) ──────────────────────────────────
  if (product.image) {
    if (typeof product.image === "string" && product.image.startsWith("http")) return product.image;
    if (typeof product.image?.url === "string" && product.image.url.startsWith("http")) return product.image.url;
    if (typeof product.image?.src === "string" && product.image.src.startsWith("http")) return product.image.src;
  }

  // ── images array ─────────────────────────────────────────────────────
  if (Array.isArray(product.images) && product.images.length > 0) {
    for (const img of product.images) {
      if (typeof img === "string" && img.startsWith("http")) return img;
      if (typeof img?.url === "string" && img.url.startsWith("http")) return img.url;
      if (typeof img?.src === "string" && img.src.startsWith("http")) return img.src;
    }
  }

  // ── variant images ────────────────────────────────────────────────────
  if (Array.isArray(product.variants) && product.variants.length > 0) {
    for (const v of product.variants) {
      if (typeof v?.image?.url === "string" && v.image.url.startsWith("http")) return v.image.url;
      if (typeof v?.image?.src === "string" && v.image.src.startsWith("http")) return v.image.src;
      if (typeof v?.image === "string" && v.image.startsWith("http")) return v.image;
    }
  }

  // Not found — return null so frontend can show a placeholder
  return null;
}

/**
 * v4.0: Category coherence scoring.
 *
 * When the search query contains a clear product-type noun (e.g. "cylinder"),
 * products whose title doesn't contain that noun or a known synonym get
 * a negative coherence score. This pushes accessories and unrelated items
 * to the bottom instead of mixing them with real results.
 *
 * This is a SOFT filter — it deprioritizes, it doesn't drop.
 */
const CATEGORY_SYNONYMS = {
  cylinder: ["cylinder", "cylinders", "actuator", "piston"],
  valve: ["valve", "valves"],
  breaker: ["breaker", "breakers", "mcb", "mccb", "rccb"],
  sensor: ["sensor", "sensors", "detector", "switch"],
  pump: ["pump", "pumps"],
  motor: ["motor", "motors"],
  drive: ["drive", "drives", "inverter", "vfd", "vsd"],
  relay: ["relay", "relays"],
  contactor: ["contactor", "contactors"],
  transformer: ["transformer", "transformers"],
  cable: ["cable", "cables", "wire", "wires"],
  connector: ["connector", "connectors"],
  fuse: ["fuse", "fuses"],
  switch: ["switch", "switches"],
};

/**
 * v4.1: BRAND COHERENCE GATE
 *
 * When the user query is a single token that matches a known industrial brand,
 * we DROP products whose title/description/tags don't contain that brand.
 * This prevents the "user searches ABB, sees Siemens cards" trust-breaker.
 *
 * Raw MCP products do NOT carry a `vendor` field (verified from prod
 * [ImageDebug] logs: keys are id, title, description, url, price_range,
 * variants, options, media, tags). So we match brand mentions inside
 * title + description + tags using a word-boundary regex.
 *
 * Whitelist covers brands actually carried by Creative Automation. Multi-word
 * aliases (e.g. "phoenix-contact", "allen bradley") are normalised: any space
 * or hyphen in the haystack is treated as either.
 */
const KNOWN_BRANDS = [
  // canonical, [aliases]
  ["abb", []],
  ["siemens", []],
  ["schneider", ["schneider-electric"]],
  ["phoenix", ["phoenix-contact", "phoenixcontact"]],
  ["allen-bradley", ["allen bradley", "allenbradley", "ab"]],
  ["rockwell", []],
  ["omron", []],
  ["smc", []],
  ["festo", []],
  ["mitsubishi", []],
  ["eaton", []],
  ["hager", []],
  ["legrand", []],
  ["ifm", []],
  ["pepperl-fuchs", ["pepperl+fuchs", "pepperl"]],
  ["sick", []],
  ["turck", []],
  ["balluff", []],
  ["wago", []],
  ["weidmuller", ["weidmüller"]],
  ["murr", ["murrelektronik"]],
  ["beckhoff", []],
  ["lapp", []],
  ["pilz", []],
  ["banner", []],
  ["telemecanique", []],
  ["te-connectivity", ["te connectivity"]],
  ["honeywell", []],
];

function detectBrandQuery(rawQuery) {
  if (!rawQuery || typeof rawQuery !== "string") return null;
  const trimmed = rawQuery.trim();
  if (!trimmed) return null;
  // Single-token brand query (e.g. "ABB"), or "<brand>" in a 1-3 word query
  const lower = trimmed.toLowerCase();
  const tokens = lower.split(/\s+/);
  if (tokens.length > 3) return null;
  const normLower = lower.replace(/\s+/g, " ");
  for (const [brand, aliases] of KNOWN_BRANDS) {
    const candidates = [brand, ...aliases];
    for (const c of candidates) {
      if (normLower === c || tokens.includes(c)) {
        return brand;
      }
    }
  }
  return null;
}

function buildBrandMatchRegex(brand) {
  const aliases = KNOWN_BRANDS.find(([b]) => b === brand)?.[1] || [];
  // Normalise hyphens/spaces in the alternation pattern: "phoenix[ -]?contact"
  const patterns = [brand, ...aliases].map((s) =>
    s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/[-\s]+/g, "[-\\s]?")
  );
  return new RegExp(`\\b(?:${patterns.join("|")})\\b`, "i");
}

function productMatchesBrand(product, brandRegex) {
  const parts = [product.title || "", typeof product.description === "string" ? product.description : "", product.vendor || ""];
  if (Array.isArray(product.tags)) parts.push(...product.tags);
  else if (typeof product.tags === "string") parts.push(product.tags);
  return brandRegex.test(parts.join(" "));
}

function getCategoryCoherenceScore(product, searchQuery) {
  if (!searchQuery || typeof searchQuery !== "string") return 0;
  const queryLower = searchQuery.toLowerCase();
  const titleLower = (product.title || "").toLowerCase();

  for (const [category, synonyms] of Object.entries(CATEGORY_SYNONYMS)) {
    // Check if the search query contains this category noun
    if (synonyms.some((s) => queryLower.includes(s))) {
      // Check if the product title contains any synonym
      if (synonyms.some((s) => titleLower.includes(s))) {
        return 10; // Product matches the category
      }
      return -50; // Product does NOT match — deprioritize
    }
  }
  return 0; // No category detected in query
}


export function createToolService() {
  const MAX_PRODUCTS_TO_DISPLAY = 12;

  function resolveProductUrl(product, shopDomain) {
    if (product.handle) return `https://${shopDomain}/products/${product.handle}`;
    const rawUrl = product.product_url || product.url || "";
    if (rawUrl) {
      const productsMatch = rawUrl.match(/\/products\/([a-z0-9][a-z0-9\-]*)/i);
      if (productsMatch && productsMatch[1]) return `https://${shopDomain}/products/${productsMatch[1]}`;
      if (rawUrl.startsWith("http")) return rawUrl;
    }
    return null;
  }

  const processProductSearchResult = (toolUseResponse, shopDomain, userQuery, searchQuery) => {
    try {
      if (!toolUseResponse?.content || toolUseResponse.content.length === 0) return [];

      let contentText = toolUseResponse.content[0].text;
      let responseData;

      try {
        responseData = typeof contentText === "string" ? JSON.parse(contentText) : contentText;
      } catch (e) {
        console.error("[ToolService] Failed to parse tool content:", e.message);
        return [];
      }

      const rawProducts =
        (Array.isArray(responseData?.products) && responseData.products) ||
        (Array.isArray(responseData?.items) && responseData.items) ||
        (Array.isArray(responseData?.results) && responseData.results) ||
        [];

      if (rawProducts.length === 0) return [];
      responseData.products = rawProducts;

      console.log(`[ToolService] Search returned ${rawProducts.length} products`);

      // Vendor inference: MCP responses lack a `vendor` field. Many industrial
      // products are titled "BrandName ModelNumber" (e.g. "Siemens 3RA2932-..."),
      // so use the first alphabetic word as a vendor hint when missing.
      responseData.products.forEach((p) => {
        if (!p.vendor && p.title) {
          const firstWord = String(p.title).split(/\s+/)[0] || "";
          if (/^[A-Za-z]{2,12}$/.test(firstWord)) {
            p.vendor = firstWord;
          }
        }
      });

      // ─────────────────────────────────────────────────────────────────
      // DISTINCTIVE-TOKEN GATE (v4.0: relaxed — units are now stopwords)
      // ─────────────────────────────────────────────────────────────────
      const distinctiveTokens = extractDistinctiveTokens(searchQuery || "");

      const queryTrimmed = (searchQuery || "").trim();
      const isPureSkuQuery = queryTrimmed.length >= 4 &&
        !/\s/.test(queryTrimmed) &&
        /[A-Z]/i.test(queryTrimmed) &&
        /\d/.test(queryTrimmed);
      const skuNormalized = isPureSkuQuery
        ? queryTrimmed.toLowerCase().replace(/[-\.\/]/g, "")
        : null;

      if (distinctiveTokens.length > 0 || isPureSkuQuery) {
        const literalMatches = [];
        for (const p of responseData.products) {
          const hay = buildProductSearchText(p).toLowerCase();
          if (distinctiveTokens.length > 0 && distinctiveTokens.some((t) => hay.includes(t))) {
            literalMatches.push(p);
            continue;
          }
          if (skuNormalized) {
            const hayNorm = hay.replace(/[-\.\/]/g, "");
            if (hayNorm.includes(skuNormalized)) literalMatches.push(p);
          }
        }

        if (literalMatches.length === 0) {
          console.log(`[ToolService] Strict gate: 0 matches [${distinctiveTokens.join(", ")}${skuNormalized ? ` / SKU:${skuNormalized}` : ""}] — dropping ${responseData.products.length} unrelated results`);
          return [];
        }

        if (literalMatches.length < responseData.products.length) {
          console.log(`[ToolService] Strict gate: kept ${literalMatches.length}/${responseData.products.length} (tokens: [${distinctiveTokens.join(", ")}])`);
          responseData.products = literalMatches;
        }
      }

      // ─────────────────────────────────────────────────────────────────
      // BRAND COHERENCE GATE (v4.1)
      // If the user query is a known brand name, drop products that don't
      // mention the brand in title/description/tags. Raw MCP products lack
      // the `vendor` field, so we match brand text in product content.
      // ─────────────────────────────────────────────────────────────────
      const brand = detectBrandQuery(userQuery || "") || detectBrandQuery(searchQuery || "");
      if (brand) {
        const brandLower = brand.toLowerCase();
        // Prefer the structured vendor field when any product has one
        const vendorMatches = responseData.products.filter(
          (p) => typeof p.vendor === "string" && p.vendor.toLowerCase() === brandLower
        );

        if (vendorMatches.length > 0) {
          console.log(`[ToolService] Brand gate (vendor): kept ${vendorMatches.length}/${responseData.products.length} for "${brand}"`);
          responseData.products = vendorMatches;
        } else {
          // Fall back to text matching across title/desc/tags/vendor
          const brandRegex = buildBrandMatchRegex(brand);
          const textMatches = responseData.products.filter((p) => productMatchesBrand(p, brandRegex));
          if (textMatches.length > 0) {
            if (textMatches.length < responseData.products.length) {
              console.log(`[ToolService] Brand gate (text): kept ${textMatches.length}/${responseData.products.length} for "${brand}"`);
              responseData.products = textMatches;
            }
          } else {
            // NON-DESTRUCTIVE: keep all products. Claude is told elsewhere
            // (system prompt) to verify brand from the vendor field before
            // claiming brand association.
            console.log(`[ToolService] Brand gate: no "${brand}" match in ${responseData.products.length} — KEEPING ALL (non-destructive)`);
          }
        }
      }

      // ─────────────────────────────────────────────────────────────────
      // INCH-DIMENSION GATE (v4.0: RELAXED — no longer drops ALL results)
      //
      // If the user specified an inch dimension (e.g. '2"', '1 inch'),
      // we TRY to filter products that mention that dimension.
      // But if ZERO products match, we KEEP ALL products instead of
      // returning nothing. The user still sees relevant product types,
      // even if the dimension filter couldn't be applied.
      // ─────────────────────────────────────────────────────────────────
      const inchDims = [...new Set([...extractInchDimensions(searchQuery || ""), ...extractInchDimensions(userQuery || "")])];

      if (inchDims.length > 0) {
        const dimMatches = responseData.products.filter((p) => {
          const hay = buildProductSearchText(p).toLowerCase();
          return inchDims.some((d) => productMatchesInchDim(hay, d));
        });

        if (dimMatches.length > 0 && dimMatches.length < responseData.products.length) {
          // Some products match the dimension — use only those
          console.log(`[ToolService] Inch-dim gate: kept ${dimMatches.length}/${responseData.products.length}`);
          responseData.products = dimMatches;
        } else if (dimMatches.length === 0) {
          // v4.0 FIX: ZERO matches — keep ALL products instead of dropping.
          // Products are already filtered by category from the search query.
          // Dropping all results gives a worse UX than showing them without
          // the dimension filter. The user can visually filter by size.
          console.log(`[ToolService] Inch-dim gate: 0 of ${responseData.products.length} match [${inchDims.map((d) => `${d}"`).join(", ")}] — KEEPING ALL (relaxed gate)`);
          // No change to responseData.products
        }
      }

      // ─────────────────────────────────────────────────────────────────
      // SPEC EXTRACTION & RE-RANKING
      // ─────────────────────────────────────────────────────────────────
      const userSpecs = extractQuerySpecs(userQuery || "");
      const searchSpecs = extractQuerySpecs(searchQuery || "");
      const mergedSpecs = {
        dimensions: [...new Set([...userSpecs.dimensions, ...searchSpecs.dimensions])],
        skuPatterns: [...new Set([...userSpecs.skuPatterns, ...searchSpecs.skuPatterns])],
        rawNumbers: [...new Set([...userSpecs.rawNumbers, ...searchSpecs.rawNumbers])],
      };
      const hasSpecs = mergedSpecs.dimensions.length > 0 || mergedSpecs.skuPatterns.length > 0 || mergedSpecs.rawNumbers.length > 0;

      if (hasSpecs) {
        console.log(`[ToolService] Specs — dims: [${mergedSpecs.dimensions}], SKUs: [${mergedSpecs.skuPatterns}], ratings: [${mergedSpecs.rawNumbers}]`);
      }

      // ─────────────────────────────────────────────────────────────────
      // MAP PRODUCTS — v4.0 image extraction (media[].image.url first)
      // ─────────────────────────────────────────────────────────────────
      const fixedProducts = responseData.products.map((p) => {
        const rawImageUrl = extractImageUrl(p);
        const productUrl = resolveProductUrl(p, shopDomain);

        let firstVariant = null;
        if (Array.isArray(p.variants) && p.variants.length > 0) firstVariant = p.variants[0];
        const variantIdRaw = firstVariant?.id || firstVariant?.variant_id || null;
        const priceText = formatPrice(p);
        const specScore = hasSpecs ? scoreProductBySpecs(p, mergedSpecs) : 0;
        const categoryScore = getCategoryCoherenceScore(p, searchQuery || userQuery || "");

        return {
          id: p.product_id || p.id,
          title: p.title || "Untitled Product",
          handle: p.handle || null,
          image_url: rawImageUrl,
          url: productUrl,
          price: priceText,
          description: extractDescription(p),
          variant_id: variantIdRaw,
          merchandise_id: variantIdRaw,
          sku: p.sku || firstVariant?.sku || null,
          _specScore: specScore,
          _categoryScore: categoryScore,
        };
      });

      // ─────────────────────────────────────────────────────────────────
      // RANKING — v4.0: exact SKU first, then category coherence
      // ─────────────────────────────────────────────────────────────────
      let rankedProducts = fixedProducts;

      if (hasSpecs) {
        // Sort by spec score descending, then by category score descending
        const withScores = [...rankedProducts].sort((a, b) => {
          if (b._specScore !== a._specScore) return b._specScore - a._specScore;
          return b._categoryScore - a._categoryScore;
        });
        const topScore = withScores[0]?._specScore || 0;

        if (topScore >= 200) {
          // v4.0: Exact SKU field match (score ≥200). Keep only exact matches.
          const exactSkuMatches = withScores.filter((p) => p._specScore >= 200);
          console.log(`[ToolService] Exact SKU field match: ${exactSkuMatches.length} products (score ≥200)`);
          rankedProducts = exactSkuMatches;
        } else if (topScore >= 100) {
          const titleMatches = withScores.filter((p) => p._specScore >= 100);
          console.log(`[ToolService] Title SKU match: ${titleMatches.length} products (score ≥100)`);
          rankedProducts = titleMatches;
        } else if (topScore > 0) {
          const matched = withScores.filter((p) => p._specScore > 0);
          const unmatched = withScores.filter((p) => p._specScore === 0);
          console.log(`[ToolService] Spec re-rank: ${matched.length} matched, ${unmatched.length} passthrough`);
          rankedProducts = [...matched, ...unmatched];
        }
      } else {
        // No specs detected — sort by category coherence only
        rankedProducts = [...rankedProducts].sort((a, b) => b._categoryScore - a._categoryScore);
      }

      // v4.0: If category scoring pushed accessories to the bottom,
      // and we have enough "good" products, trim the accessories
      const goodProducts = rankedProducts.filter((p) => p._categoryScore >= 0);
      if (goodProducts.length >= 3 && goodProducts.length < rankedProducts.length) {
        console.log(`[ToolService] Category filter: kept ${goodProducts.length}/${rankedProducts.length} category-matching products`);
        rankedProducts = goodProducts;
      }

      // ─────────────────────────────────────────────────────────────────
      // VOLTAGE FILTER (v4.1)
      // If the user said "24V", "24VDC", "230VAC" etc., prefer products
      // whose variant titles/SKUs contain that voltage. If ≥3 match, keep
      // only those. Otherwise leave the list unchanged.
      // ─────────────────────────────────────────────────────────────────
      const voltageQuery = userQuery || searchQuery || "";
      const voltageMatches = [...voltageQuery.matchAll(/\b(\d{1,4})\s*v(dc|ac)?\b/gi)];
      if (voltageMatches.length > 0) {
        const wanted = voltageMatches.map((m) => ({
          v: m[1],
          suffix: (m[2] || "").toLowerCase(),
        }));
        const productMatchesVoltage = (p) => {
          const variants = Array.isArray(p.variants) ? p.variants : [];
          const variantText = variants.map((v) => `${v.title || ""} ${v.sku || ""}`).join(" ").toLowerCase();
          const productText = `${p.title || ""} ${typeof p.description === "string" ? p.description : ""}`.toLowerCase();
          const hay = `${variantText} ${productText}`;
          return wanted.some(({ v, suffix }) => {
            // "24v", "24 v", "24vdc", "24 vdc" — also "24v dc"
            const re = new RegExp(`\\b${v}\\s*v${suffix ? suffix : "(?:dc|ac)?"}\\b`, "i");
            return re.test(hay);
          });
        };
        const filtered = rankedProducts.filter(productMatchesVoltage);
        if (filtered.length >= 3 && filtered.length < rankedProducts.length) {
          console.log(`[ToolService] Voltage filter: kept ${filtered.length}/${rankedProducts.length} products matching ${wanted.map((w) => w.v + "V" + w.suffix.toUpperCase()).join(",")}`);
          rankedProducts = filtered;
        } else if (filtered.length > 0 && filtered.length < rankedProducts.length) {
          // Few matches — promote them but keep the rest
          const rest = rankedProducts.filter((p) => !filtered.includes(p));
          console.log(`[ToolService] Voltage filter: promoted ${filtered.length} matching products (kept ${rankedProducts.length} total)`);
          rankedProducts = [...filtered, ...rest];
        } else {
          console.log(`[ToolService] Voltage filter: ${filtered.length}/${rankedProducts.length} match — no change`);
        }
      }

      rankedProducts.forEach((p) => { delete p._specScore; delete p._categoryScore; });

      console.log(`[ToolService] Returning ${Math.min(rankedProducts.length, MAX_PRODUCTS_TO_DISPLAY)} products`);

      responseData.products = rankedProducts;
      toolUseResponse.content[0].text = JSON.stringify(responseData);

      return rankedProducts.slice(0, MAX_PRODUCTS_TO_DISPLAY);
    } catch (error) {
      console.error("[ToolService] Error processing product search results:", error);
      return [];
    }
  };

  const processCartUpdateResult = (toolUseResponse) => {
    if (!toolUseResponse || toolUseResponse.error) return { checkoutUrl: null, cart: null };

    try {
      const raw = toolUseResponse.content?.[0]?.text ?? toolUseResponse.content?.[0]?.data;
      const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;

      if (!parsed || typeof parsed !== "object") return { checkoutUrl: null, cart: null };

      const checkoutUrl =
        parsed.checkout_url ||
        parsed.checkoutUrl ||
        parsed.cart?.checkoutUrl ||
        parsed.cart?.checkout_url ||
        parsed.data?.cart?.checkoutUrl ||
        parsed.data?.cart?.checkout_url ||
        null;

      const cart = parsed.cart || parsed.data?.cart || parsed;
      if (checkoutUrl) console.log(`[ToolService] Checkout URL: ${checkoutUrl.substring(0, 60)}...`);
      return { checkoutUrl, cart };
    } catch (error) {
      console.error("[ToolService] Error processing cart update result:", error);
      return { checkoutUrl: null, cart: null };
    }
  };

  return { processProductSearchResult, processCartUpdateResult };
}

export default { createToolService };
