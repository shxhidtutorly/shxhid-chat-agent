/**
 * Query Classifier
 *
 * Classifies an incoming user message into one of:
 *   - SKU                   — likely a product code/SKU
 *   - BRAND_ONLY            — single brand-like word
 *   - BRAND_PLUS_CATEGORY   — brand-like word + category words
 *   - FREE_TEXT             — anything else (let MCP handle)
 *
 * No hardcoded brand whitelist — pattern-based detection only.
 */

const COMMON_WORDS = new Set([
  // Verbs / chat-isms users start with
  "show", "find", "search", "get", "list", "help", "need", "want", "looking",
  "give", "tell", "send", "buy", "order", "browse", "explore", "have",
  "what", "where", "which", "who", "why", "how", "when", "is", "are",
  "do", "does", "did", "can", "could", "would", "should", "may", "might",
  "i", "we", "you", "they", "me", "us", "hi", "hello", "hey", "yo",
  // Common nouns that look "brand-ish"
  "products", "product", "items", "item", "things", "stuff", "store", "shop",
  "catalog", "inventory", "price", "prices", "thanks", "thank", "please",
  "yes", "no", "ok", "okay",
]);

function isCommonWord(word) {
  return COMMON_WORDS.has(word.toLowerCase());
}

// SKU heuristic: a single-ish token mixing letters and digits, length >=4,
// optional separators (-./).
function looksLikeSku(token) {
  if (!token) return false;
  const t = token.replace(/\s+/g, "");
  if (t.length < 4) return false;
  if (!/^[A-Z0-9][A-Z0-9\-\.\/]{3,}$/i.test(t)) return false;
  if (!/\d/.test(t)) return false;
  if (!/[A-Za-z]/.test(t)) return false;
  // Skip pure measurements like 24VDC, 18MM
  if (/^\d+(?:MM|CM|VDC|VAC|V|A|W|KW|HP|INCH|IN|FT)$/i.test(t)) return false;
  return true;
}

// "Brand-like" word: alphabetic only, 2-12 chars,
// either ALL-CAPS (ABB, SMC) or Title-case (Siemens, Mindman).
// Rejects common chat words.
function looksLikeBrandWord(word) {
  if (!word) return false;
  if (!/^[A-Za-z]{2,12}$/.test(word)) return false;
  if (isCommonWord(word)) return false;
  const isAllCaps = /^[A-Z]{2,8}$/.test(word);
  const isTitleCase = /^[A-Z][a-z]{1,11}$/.test(word);
  return isAllCaps || isTitleCase;
}

export function classifyQuery(query) {
  if (!query || typeof query !== "string") {
    return { type: "FREE_TEXT", query: query || "", original: query || "" };
  }

  const original = query.trim();
  if (!original) return { type: "FREE_TEXT", query: "", original: "" };

  const words = original.split(/\s+/);

  // SKU: single token (or two tokens that joined still look SKU-like) with
  // mixed letters+digits.
  if (words.length === 1 && looksLikeSku(words[0])) {
    return { type: "SKU", sku: words[0], original };
  }
  if (words.length === 2) {
    const joined = words.join("");
    if (looksLikeSku(joined) && !/^[A-Za-z]+$/.test(words[0])) {
      return { type: "SKU", sku: joined, original };
    }
  }

  // Two-word brand: "Allen Bradley contactors", "Phoenix Contact relays"
  if (words.length >= 3 && looksLikeBrandWord(words[0]) && looksLikeBrandWord(words[1])) {
    const remainderWords = words.slice(2);
    // Avoid mis-classifying e.g. "Hello There Friend"
    if (!remainderWords.every((w) => isCommonWord(w))) {
      return {
        type: "BRAND_PLUS_CATEGORY",
        brand: `${words[0]} ${words[1]}`,
        remainder: remainderWords.join(" "),
        original,
      };
    }
  }

  // Single-word brand
  if (looksLikeBrandWord(words[0])) {
    if (words.length === 1) {
      return { type: "BRAND_ONLY", brand: words[0], remainder: "", original };
    }

    // BRAND + CATEGORY: second word must NOT be a common chat verb
    if (!isCommonWord(words[1])) {
      return {
        type: "BRAND_PLUS_CATEGORY",
        brand: words[0],
        remainder: words.slice(1).join(" "),
        original,
      };
    }
  }

  return { type: "FREE_TEXT", query: original, original };
}
