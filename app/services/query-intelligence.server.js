/**
 * Query Intelligence Service — v1.1 (Production Fix)
 *
 * CHANGES (v1.1 — May 2026):
 *
 * FIX 1: Size designations are PRODUCT IDENTIFIERS, not specs to strip.
 *   Previous SYSTEM_PROMPT said "REMOVE dimensions (mm, inch)" too broadly.
 *   This caused queries like "1/4 inch AODD pump" to potentially lose "1/4 inch"
 *   — but the Algolia index has products literally titled "1/4 Inch AODD Pumps".
 *   Stripping the size makes it impossible to find the right pump.
 *
 *   UPDATED RULE: Keep sizes/dimensions when they ARE the product designation
 *   (pump size, pipe size, valve port count). Strip them only when they are
 *   separate filter criteria unrelated to the product name/type.
 *
 * FIX 2: Valve configurations (5/2 way, 3/2 way) are NOT SKUs.
 *   Added explicit example in prompt: "5/2 way solenoid valve" → keep "5/2 way".
 *   The SKU detector was fixed separately (Pattern 4), but QueryIntel should
 *   also understand valve port/position notation.
 *
 * FIX 3: Added examples for AODD pump sizes and valve configurations.
 *
 * Uses Claude Haiku (fast, cheap) to convert natural language
 * user messages into optimized 2-5 word Algolia search queries.
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

4. WHAT TO STRIP vs KEEP:
   STRIP (these are filter specs that don't appear in product titles):
     - Electrical specs: voltage (24V, 230VAC, 400V), amperage (100A), frequency (50Hz)
     - IP/protection ratings: IP67, IP68
     - Wire count: "3 wire", "4 wire"
     - Sensing range as standalone spec: "4mm range", "sensing distance 50mm"
     - Generic fillers: industrial, commercial, heavy duty, professional grade

   KEEP (these ARE the product designation or appear in the product title):
     - Pipe/pump sizes: "1/4 inch", "1/2 inch", "3/4 inch", "2 inch", "3 inch"
       → "1/4 Inch AODD Pumps" is a real product title; never strip this size
     - Valve port/position config: "5/2 way", "3/2 way", "4/2 way"
       → "5/2 way solenoid valve" — the "5/2 way" IS the valve type
     - Cable/hose length when it identifies the product: "20m ethernet cable", "5m sensor cable"
     - Thread type: NPT, BSP, BSPP (these are product attributes in titles)
     - Power rating when it's the product designator: "30kW inverter drive"
     - Body material when in title: "aluminium", "stainless steel", "polypropylene"
     - Sensing ranges and dimensions: write with a space between value
       and unit ("60 mm" not "60mm", "5 mm" not "5mm"). The catalog
       titles use the spaced form. Concatenating loses phrase-match
       opportunities downstream.

5. EXCEPTION — NEVER strip SKU / part / model codes. Any alphanumeric token
   with letters AND digits and length >= 5 (e.g. "BP06PP-PTT4-B", "S201-B16",
   "ACS580", "T4171010405-001", "DSNU-20-50-P-A") is a SKU — keep it verbatim
   and make it the ENTIRE query.

6. Fix typos silently — but never "fix" SKU/part codes; copy them exactly.
7. Use catalog-standard terminology (see mappings below)
8. If conversation context is provided, use it to fill in missing product type

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
"5/2 way / 5-2 way / 5/2-way" → keep as "5/2 solenoid valve" (valve type, not SKU)
"3/2 way / 3-2 way" → keep as "3/2 solenoid valve"

EXAMPLES:
User: "show me flush mount proximity sensors"
→ {"query":"flush inductive proximity sensor","skip":false,"reason":"spec_cleaned"}

User: "1/4 Inch AODD Pumps"
→ {"query":"1/4 inch AODD pump","skip":false,"reason":"size_designation_kept"}

User: "do you have 1/4 inch BSK pumps?"
→ {"query":"1/4 inch AODD pump BSK","skip":false,"reason":"size_kept_brand_added"}

User: "1/2 inch polypropylene AODD pump"
→ {"query":"1/2 inch AODD pump polypropylene","skip":false,"reason":"size_and_material_kept"}

User: "5/2 way solenoid valve"
→ {"query":"5/2 solenoid valve","skip":false,"reason":"valve_config_kept"}

User: "3/2 way directional control valve"
→ {"query":"3/2 directional control valve","skip":false,"reason":"valve_config_kept"}

User: "60 mm sensing range"
Context: user was asking about SICK proximity sensors
→ {"query":"SICK proximity sensor 60 mm","skip":false,"reason":"context_enriched_size_kept_spaced"}

User: "M12 4mm sensing range"
→ {"query":"M12 proximity sensor 4 mm","skip":false,"reason":"size_spaced"}

User: "4mm sensing range M12"
Context: user was asking about IFM sensors
→ {"query":"IFM M12 proximity sensor","skip":false,"reason":"context_enriched"}

User: "te connectivity productsd"
→ {"query":"TE Connectivity","skip":false,"reason":"brand_query_typo_fixed"}

User: "NPN output 3 wire 24VDC"
→ {"query":"NPN proximity sensor","skip":false,"reason":"specs_stripped_kept_output_type"}

User: "AODD pump 3 inch aluminum body"
→ {"query":"3 inch AODD pump aluminium","skip":false,"reason":"size_and_material_kept"}

User: "push in fittings 6mm"
→ {"query":"push-in pneumatic fitting","skip":false,"reason":"term_mapped"}

User: "inverter drive 30kw power rating"
→ {"query":"inverter drive 30kw","skip":false,"reason":"power_rating_kept_as_designator"}

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
→ {"query":"BA25SS-STT3-A","skip":false,"reason":"sku_only"}

User: "looking for DSNU-20-50-P-A"
→ {"query":"DSNU-20-50-P-A","skip":false,"reason":"sku_only"}

User: "I need pneumatic components for manufacturing"
→ {"query":"pneumatic cylinder valve","skip":false,"reason":"broad_category_expanded"}

User: "pneumatic parts"
→ {"query":"pneumatic cylinder SMC","skip":false,"reason":"broad_category_expanded_with_brand"}`;

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

  // Build a context summary from the last turn. We ONLY feed prior context
  // when the current message is plainly a clarifier of the previous turn
  // (e.g. "show me only", "with", "the first one"). Treating every message
  // as a follow-up bleeds the previous brand/category into unrelated
  // searches — "do you have circuit breakers" after a SICK sensor question
  // would otherwise be rewritten as "SICK circuit breaker".
  const CLARIFIER = /^(show me only|filter by|with |the first one|which one|only the|and the|in stock|cheaper|more expensive|larger|smaller|same but|like the (first|second|last|one|previous))\b/i;
  const isClarifier = CLARIFIER.test(trimmed);

  let contextSummary = '';
  if (isClarifier && conversationContext && conversationContext.length > 0) {
    const recentTurns = conversationContext
      .filter(m => m.role === 'user' || m.role === 'assistant')
      .slice(-2) // last user+assistant pair only
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
      // Haiku is deliberate here (single-shot, ~20-token output — latency and
      // cost dominate). Env-overridable for A/B without a deploy.
      model: process.env.CLAUDE_QUERYINTEL_MODEL || 'claude-haiku-4-5-20251001',
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
