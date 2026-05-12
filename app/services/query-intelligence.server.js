/**
 * Query Intelligence Service — v1.0
 *
 * Uses Claude Haiku (fast, cheap) to convert natural language
 * user messages into optimized 2-5 word Algolia search queries.
 *
 * Why Haiku here (not Sonnet):
 *   - Task is simple: extract search intent, ~20 token output
 *   - ~200ms latency, $0.0001 per call
 *   - Runs in parallel with MCP connection — net latency ~0ms
 *
 * Input:  user message + last 2 conversation turns (context)
 * Output: { query, skip, reason }
 */

import Anthropic from '@anthropic-ai/sdk';

const SYSTEM_PROMPT = `You are a search query optimizer for an industrial automation B2B product catalog.

Convert the user's message into the optimal product search query for Algolia.

CATALOG CONTEXT:
This store sells industrial automation equipment including:
- Sensors (proximity, photoelectric, pressure, temperature, flow)
- Drives & Motors (VFDs, servo drives, stepper motors)
- Pneumatics (cylinders, valves, fittings, AODD pumps)
- Electrical (circuit breakers, contactors, relays, power supplies)
- Connectivity (terminals, cables, connectors)
- PLCs, HMIs, Encoders

RULES:
1. Output ONLY valid JSON on a single line: {"query":"...","skip":false,"reason":"..."}
2. Set skip:true ONLY if the message has NO product search intent whatsoever
3. Extract brand name + product type as the core query (2-5 words max)
4. REMOVE from query: dimensions (mm, inch), voltages (V, VDC), IP ratings, sensing ranges, wire counts
   These are NOT in product titles and hurt Algolia relevance.
   EXCEPTION: NEVER strip SKU / part / model codes. Any alphanumeric token
   with letters AND digits and length >= 5 (e.g. "BP06PP-PTT4-B", "S201-B16",
   "ACS580", "T4171010405-001", "DSNU-20-50-P-A") is a SKU — keep it verbatim
   and make it the ENTIRE query. Do not add brand or category words around it.
5. Fix typos silently — but never "fix" SKU/part codes; copy them exactly.
6. Use catalog-standard terminology (see mappings below)
7. If conversation context is provided, use it to fill in missing product type

TERMINOLOGY MAPPINGS (user term → catalog term):
"flush mount/flush type/embeddable" → "flush" (keep it)
"non flush/unshielded" → "non-flush"
"inductive sensor/proximity switch" → "proximity sensor" OR "inductive sensor"
"photoelectric/light sensor/optical" → "photoelectric sensor"
"AODD/air operated diaphragm" → "AODD pump"
"VFD/inverter/frequency drive" → "variable frequency drive"
"MCB/miniature circuit breaker" → "circuit breaker"
"MCCB" → "moulded case circuit breaker"
"push in/push-in fitting" → "push-in fitting"
"pneumatic fitting/tube fitting" → "pneumatic fitting"
"solenoid/solenoid coil" → "solenoid valve"
"limit switch/position switch" → "limit switch"
"encoder/rotary encoder" → "rotary encoder"
"RTD/thermocouple" → keep as-is
"current transformer/CT" → "current transformer"

EXAMPLES:
User: "show me flush mount proximity sensors"
→ {"query":"flush inductive proximity sensor","skip":false,"reason":"spec_cleaned"}

User: "4mm sensing range M12"
Context: user was asking about IFM sensors
→ {"query":"IFM M12 proximity sensor","skip":false,"reason":"context_enriched"}

User: "te connectivity productsd"
→ {"query":"TE Connectivity","skip":false,"reason":"brand_query_typo_fixed"}

User: "NPN output 3 wire 24VDC"
→ {"query":"NPN proximity sensor","skip":false,"reason":"specs_stripped"}

User: "AODD pump 3 inch aluminum body"
→ {"query":"3 inch AODD pump aluminium","skip":false,"reason":"cleaned"}

User: "push in fittings 6mm"
→ {"query":"push-in pneumatic fitting","skip":false,"reason":"term_mapped"}

User: "M12 threaded body non flush"
→ {"query":"M12 non-flush proximity sensor","skip":false,"reason":"spec_mapped"}

User: "what brands do you carry?"
→ {"query":"","skip":true,"reason":"conversational"}

User: "thanks" or "ok" or "yes"
→ {"query":"","skip":true,"reason":"conversational"}

User: "which one has the longest range?"
Context: user was asking about photoelectric sensors
→ {"query":"photoelectric sensor long range","skip":false,"reason":"context_used"}

User: "do you have 1/4 Inch AODD Pumps BP06PP-PTT4-B -BSK"
→ {"query":"BP06PP-PTT4-B","skip":false,"reason":"sku_extracted"}

User: "show me ABB circuit breakers S201-B16"
→ {"query":"S201-B16","skip":false,"reason":"sku_extracted"}

User: "can you find the BA25SS-STT3-A AODD pump"
→ {"query":"BA25SS-STT3-A","skip":false,"reason":"sku_extracted"}

User: "looking for DSNU-20-50-P-A"
→ {"query":"DSNU-20-50-P-A","skip":false,"reason":"sku_only"}`;

// Simple in-memory cache to avoid duplicate rewriter calls for same query
const queryCache = new Map();
const MAX_CACHE_SIZE = 200;

export async function rewriteQueryForSearch(userMessage, conversationContext = []) {
  if (!userMessage || typeof userMessage !== 'string') {
    return { query: userMessage, skip: false, reason: 'no_message' };
  }

  const trimmed = userMessage.trim();
  if (!trimmed || trimmed.length < 2) {
    return { query: trimmed, skip: true, reason: 'too_short' };
  }

  // Build a context summary from the last 2 turns
  let contextSummary = '';
  if (conversationContext && conversationContext.length > 0) {
    const recentTurns = conversationContext
      .filter(m => m.role === 'user' || m.role === 'assistant')
      .slice(-4) // last 2 user+assistant pairs
      .map(m => {
        const content = typeof m.content === 'string'
          ? m.content
          : (Array.isArray(m.content)
              ? m.content.filter(b => b.type === 'text').map(b => b.text).join(' ')
              : '');
        // Truncate individual messages and strip SYSTEM NOTE injections
        const clean = content
          .replace(/\[SYSTEM.*?\]/gs, '')
          .replace(/\[SYSTEM NOTE.*?\]/gs, '')
          .trim()
          .substring(0, 120);
        return clean ? `${m.role}: ${clean}` : null;
      })
      .filter(Boolean);

    if (recentTurns.length > 0) {
      contextSummary = `\nPrevious conversation:\n${recentTurns.join('\n')}`;
    }
  }

  // Cache key includes context for context-aware caching
  const cacheKey = `${trimmed}|||${contextSummary.substring(0, 100)}`;
  if (queryCache.has(cacheKey)) {
    const cached = queryCache.get(cacheKey);
    console.log(`[QueryIntel] Cache hit: "${trimmed}" → "${cached.query}"`);
    return cached;
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return { query: trimmed, skip: false, reason: 'no_api_key' };
  }

  try {
    const client = new Anthropic({ apiKey });

    const userContent = contextSummary
      ? `${contextSummary}\n\nCurrent user message: "${trimmed}"`
      : `User message: "${trimmed}"`;

    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 100,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userContent }],
    });

    const rawText = response.content?.[0]?.text?.trim() || '';

    let result;
    try {
      // Extract JSON from response (handle any extra text)
      const jsonMatch = rawText.match(/\{[^}]+\}/);
      const parsed = JSON.parse(jsonMatch ? jsonMatch[0] : rawText);

      result = {
        query: (parsed.query || '').trim(),
        skip: !!parsed.skip,
        reason: parsed.reason || 'rewritten',
      };

      // If rewritten query is empty but skip=false, use original
      if (!result.query && !result.skip) {
        result.query = trimmed;
        result.reason = 'fallback_original';
      }
    } catch (parseErr) {
      console.warn(`[QueryIntel] JSON parse failed: "${rawText}"`);
      result = { query: trimmed, skip: false, reason: 'parse_error' };
    }

    if (result.query !== trimmed || result.skip) {
      console.log(
        `[QueryIntel] "${trimmed}" → "${result.query}" (${result.reason})`
      );
    }

    // Cache with size limit
    if (queryCache.size >= MAX_CACHE_SIZE) {
      const firstKey = queryCache.keys().next().value;
      queryCache.delete(firstKey);
    }
    queryCache.set(cacheKey, result);

    return result;
  } catch (err) {
    console.warn(`[QueryIntel] Rewrite failed: ${err.message} — using original`);
    return { query: trimmed, skip: false, reason: 'api_error' };
  }
}
