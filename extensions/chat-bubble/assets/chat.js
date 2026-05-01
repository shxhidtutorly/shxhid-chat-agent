// app/routes/chat.jsx
/**
 * Chat API Route — v2.2
 *
 * PATCH v2.2 — May 1, 2026 — CRITICAL FIX: search_catalog tool schema
 *
 * ROOT CAUSE (confirmed from production logs):
 *   The Shopify Storefront MCP renamed the catalog search tool from
 *   `search_shop_catalog` to `search_catalog` AND changed its input schema:
 *
 *   OLD (search_shop_catalog): { query: "solenoid valve" }
 *   NEW (search_catalog):      { catalog: { query: "solenoid valve" } }
 *
 *   The code extracted `toolArgs?.query` which returns `undefined` for the new schema.
 *   It then fell back to `JSON.stringify(toolArgs)` → '{"catalog":{"query":"..."}}'.
 *   The distinctive token gate tokenized this → ["catalog", "query"].
 *   Those tokens never appear in product text → ALL products dropped → 0 results shown.
 *   Claude retried up to MAX_TOOL_LOOPS (4), all failed → "Hit max tool loop limit".
 *   Images never shown because no products passed the gate.
 *
 * FIX:
 *   Extract query with: toolArgs?.query || toolArgs?.catalog?.query || ...
 *   Never fall back to JSON.stringify(toolArgs) as searchQuery.
 *   Add "catalog" and "query" to gate stopwords as defense-in-depth.
 *
 * CHANGES (v2.2):
 *   - Fixed searchQuery extraction to support both tool schema variants
 *   - Fixed tryFallbackSearches to extract query properly from toolArgs
 *   - Never pass JSON.stringify(toolArgs) as a search query to Storefront API
 *   - Added "catalog" + "query" to stopwords in tool.server.js (see that file)
 */

// Names Shopify's Storefront MCP has used for catalog search across versions.
const CATALOG_SEARCH_TOOL_NAMES = new Set([
  "search_shop_catalog",  // legacy
  "search_catalog",       // current (confirmed April-May 2026)
  "search_products",      // defensive
]);

function isCatalogSearchTool(toolName) {
  return CATALOG_SEARCH_TOOL_NAMES.has(String(toolName || "").toLowerCase());
}

/**
 * Extract the plain text search query from tool arguments.
 * Supports both old { query: "..." } and new { catalog: { query: "..." } } schemas.
 * NEVER returns JSON.stringify(toolArgs) — that string pollutes the relevance gate.
 */
function extractSearchQuery(toolArgs) {
  if (!toolArgs) return null;

  // New search_catalog schema: { catalog: { query: "..." } }
  if (toolArgs?.catalog?.query && typeof toolArgs.catalog.query === 'string') {
    return toolArgs.catalog.query.trim() || null;
  }

  // Legacy search_shop_catalog schema: { query: "..." }
  if (toolArgs?.query && typeof toolArgs.query === 'string') {
    return toolArgs.query.trim() || null;
  }

  // Other possible field names
  if (toolArgs?.searchQuery && typeof toolArgs.searchQuery === 'string') {
    return toolArgs.searchQuery.trim() || null;
  }
  if (toolArgs?.q && typeof toolArgs.q === 'string') {
    return toolArgs.q.trim() || null;
  }

  // If toolArgs is itself a string
  if (typeof toolArgs === 'string') {
    return toolArgs.trim() || null;
  }

  // NEVER fall back to JSON.stringify — that breaks the relevance gate
  return null;
}

export async function loader({ request }) {
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: getCorsHeaders(request),
    });
  }

  const url = new URL(request.url);

  if (url.searchParams.has("history") && url.searchParams.has("conversation_id")) {
    return handleHistoryRequest(request, url.searchParams.get("conversation_id"));
  }

  if (url.searchParams.has("stream") || request.headers.get("Accept")?.includes("text/event-stream")) {
    return handleChatRequest(request);
  }

  return new Response(
    JSON.stringify({
      status: "ok",
      message: "Chat API is running",
      endpoints: {
        chat: "POST /chat",
        history: "GET /chat?history=true&conversation_id=xxx"
      }
    }),
    {
      status: 200,
      headers: getCorsHeaders(request)
    }
  );
}

export async function action({ request }) {
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: getCorsHeaders(request),
    });
  }
  return handleChatRequest(request);
}

async function handleHistoryRequest(request, conversationId) {
  try {
    const dbMod = await import("../db.server");
    const getConversationHistory = dbMod.getConversationHistory;

    const messages = await getConversationHistory(conversationId);

    const cleanedMessages = messages.map((msg) => {
      let parsedContent = msg.content;
      try {
        const parsed = JSON.parse(msg.content);
        if (Array.isArray(parsed)) {
          parsedContent = parsed;
        }
      } catch (e) {
        parsedContent = msg.content;
      }

      return {
        id: msg.id,
        role: msg.role,
        content: parsedContent,
        contentType: msg.contentType,
        createdAt: msg.createdAt,
      };
    });

    return new Response(JSON.stringify({ messages: cleanedMessages }), {
      headers: {
        ...getCorsHeaders(request),
        "Content-Type": "application/json",
      }
    });
  } catch (error) {
    console.error("Error fetching history:", error);
    return new Response(
      JSON.stringify({ messages: [], error: error.message }),
      {
        status: 500,
        headers: {
          ...getCorsHeaders(request),
          "Content-Type": "application/json",
        }
      }
    );
  }
}

async function handleChatRequest(request) {
  try {
    const body = await request.json();
    const userMessage = body.message;
    const visitorId = body.visitor_id;
    const fingerprintId = body.fingerprint_id;

    if (!userMessage) {
      return new Response(
        JSON.stringify({ error: "Missing message" }),
        { status: 400, headers: getCorsHeaders(request) }
      );
    }

    const conversationId = body.conversation_id || `conv_${Date.now()}`;
    const promptType = body.prompt_type || "standardAssistant";

    const dbMod = await import("../db.server");
    const {
      saveMessage,
      getConversationHistory,
      storeCustomerAccountUrls,
      getCustomerAccountUrls: getCustomerAccountUrlsFromDb,
      trackAnalyticsEvent,
    } = dbMod;

    const posthogMod = await import("../services/posthog.server");
    const ChatEvents = posthogMod.ChatEvents;

    const streamMod = await import("../services/streaming.server");
    const createSseStream = streamMod.createSseStream;

    const claudeMod = await import("../services/claude.server");
    const createClaudeService = claudeMod.createClaudeService;

    const toolMod = await import("../services/tool.server");
    const createToolService = toolMod.createToolService;

    const MCPClientMod = await import("../mcp-client");
    const MCPClient = MCPClientMod.default ?? MCPClientMod;

    const reqUrl = new URL(request.url);
    const shopFromProxy = reqUrl.searchParams.get("shop");
    const shopFromBody = body.shop_domain || null;
    const origin = request.headers.get("Origin");
    const shopFromOrigin = origin ? new URL(origin).hostname : null;
    const shopDomain = shopFromProxy || shopFromBody || shopFromOrigin || process.env.SHOPIFY_STORE_DOMAIN || null;

    if (!shopDomain) {
      console.warn('[Chat] Could not resolve shop domain from request');
    }

    const trackingId = visitorId || fingerprintId || conversationId;

    try {
      ChatEvents.messageSent(trackingId, {
        conversationId,
        shopDomain,
        messageLength: userMessage.length,
      });
    } catch (e) {
      console.warn("Analytics tracking failed:", e);
    }

    const responseStream = createSseStream(async (stream) => {
      await handleChatSession({
        request,
        userMessage,
        conversationId,
        promptType,
        stream,
        visitorId,
        fingerprintId,
        shopDomain,
        helpers: {
          saveMessage,
          getConversationHistory,
          getCustomerAccountUrlsFromDb,
          storeCustomerAccountUrls,
          ChatEvents,
          createClaudeService,
          createToolService,
          MCPClient,
        },
      });
    });

    return new Response(responseStream, {
      headers: getSseHeaders(request),
    });
  } catch (error) {
    console.error("Error in chat request handler:", error);
    return new Response(
      JSON.stringify({
        error: "Internal server error",
        message: error.message
      }),
      {
        status: 500,
        headers: getCorsHeaders(request),
      }
    );
  }
}

/**
 * Server-side automatic search fallback.
 * v2.2: Uses extractSearchQuery() instead of raw JSON.stringify(toolArgs).
 */
async function tryFallbackSearches(mcpClient, originalQuery, toolName) {
  const fallbackQueries = generateFallbackQueries(originalQuery);

  for (const fallbackQuery of fallbackQueries) {
    try {
      console.log(`[Search-Fallback] Trying: "${fallbackQuery}" with tool "${toolName}"`);
      const result = await mcpClient.callStorefrontTool(toolName, {
        query: fallbackQuery,
      });

      if (result && !result.error) {
        let parsed;
        try {
          const text = result.content?.[0]?.text;
          parsed = typeof text === 'string' ? JSON.parse(text) : text;
        } catch (e) {
          continue;
        }

        const products = parsed?.products || parsed?.items || parsed?.results;
        if (Array.isArray(products) && products.length > 0) {
          console.log(`[Search-Fallback] "${fallbackQuery}" returned ${products.length} products (pending relevance gate)`);
          return { result, query: fallbackQuery };
        }
      }
    } catch (e) {
      console.warn(`[Search-Fallback] Error on "${fallbackQuery}":`, e.message);
    }
  }

  return null;
}

async function tryDirectStorefrontFallback({
  searchQuery,
  userMessage,
  shopDomain,
  toolService,
  onResultUsed,
}) {
  let searchProductsForChat;
  try {
    const mod = await import("../storefront-service.js");
    searchProductsForChat = mod.searchProductsForChat;
  } catch (importErr) {
    console.error("[Search-DirectAPI] Failed to import storefront-service:", importErr.message);
    return [];
  }

  if (typeof searchProductsForChat !== "function") {
    console.error("[Search-DirectAPI] searchProductsForChat not exported");
    return [];
  }

  const variantSet = new Set();
  const tryQueries = [];
  const push = (q) => {
    if (!q || typeof q !== "string") return;
    const trimmed = q.trim();
    if (trimmed.length < 2) return;
    const key = trimmed.toLowerCase();
    if (variantSet.has(key)) return;
    variantSet.add(key);
    tryQueries.push(trimmed);
  };

  push(searchQuery);
  push(userMessage);
  for (const fb of generateFallbackQueries(searchQuery || userMessage || "")) {
    push(fb);
  }

  for (const q of tryQueries) {
    try {
      console.log(`[Search-DirectAPI] Trying: "${q}"`);
      const wrapped = await searchProductsForChat(q, { first: 50, shopDomain });
      const products = toolService.processProductSearchResult(
        wrapped,
        shopDomain,
        userMessage,
        q,
      );
      if (products && products.length > 0) {
        console.log(`[Search-DirectAPI] Recovered ${products.length} products via direct Storefront API query: "${q}"`);
        if (typeof onResultUsed === "function") {
          onResultUsed(wrapped);
        }
        return products;
      }
    } catch (err) {
      console.warn(`[Search-DirectAPI] Error on "${q}":`, err.message);
    }
  }

  console.log(`[Search-DirectAPI] All direct Storefront API attempts returned 0 relevant products`);
  return [];
}

function generateFallbackQueries(originalQuery) {
  if (!originalQuery || typeof originalQuery !== 'string') return [];

  const queries = [];
  const trimmed = originalQuery.trim();

  const noSeparators = trimmed.replace(/[-\.\/]/g, ' ').replace(/\s+/g, ' ').trim();
  if (noSeparators !== trimmed) {
    queries.push(noSeparators);
  }

  const noUnits = trimmed
    .replace(/\d+\s*(?:VDC|VAC|V|mm|cm|inch|A|W|kW|HP)\b/gi, '')
    .replace(/\b(?:IP\d{2}|AC\d|DC\d|CAT\d[A-Z]?|RJ\d+)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (noUnits && noUnits !== trimmed && noUnits.length >= 3) {
    queries.push(noUnits);
  }

  const words = trimmed.split(/\s+/).filter(w => w.length >= 2);
  if (words.length > 2) {
    queries.push(words.slice(0, 3).join(' '));
    queries.push(words.slice(0, 2).join(' '));
  }

  if (words.length > 1 && words[0].length >= 3) {
    queries.push(words[0]);
  }

  const skuLike = trimmed.replace(/\s+/g, '');
  if (/^[A-Z0-9\-\.\/]{4,}$/i.test(skuLike) && skuLike !== trimmed) {
    const noSep = skuLike.replace(/[-\.\/]/g, '');
    if (!queries.includes(noSep)) {
      queries.push(noSep);
    }
    if (skuLike.length >= 6) {
      const firstHalf = skuLike.substring(0, Math.ceil(skuLike.length / 2));
      if (firstHalf.length >= 3 && !queries.includes(firstHalf)) {
        queries.push(firstHalf);
      }
    }
  }

  const seen = new Set([trimmed.toLowerCase()]);
  return queries.filter(q => {
    const lower = q.toLowerCase();
    if (seen.has(lower)) return false;
    seen.add(lower);
    return true;
  });
}

async function handleChatSession({
  request,
  userMessage,
  conversationId,
  promptType,
  stream,
  visitorId,
  fingerprintId,
  shopDomain,
  helpers,
}) {
  const startTime = Date.now();
  const MAX_TOOL_LOOPS = 4;

  const {
    saveMessage,
    getConversationHistory,
    getCustomerAccountUrlsFromDb,
    storeCustomerAccountUrls,
    ChatEvents,
    createClaudeService,
    createToolService,
    MCPClient,
  } = helpers;

  stream.sendMessage({ type: "id", conversation_id: conversationId });

  console.log(`[Chat] New request | conversation=${conversationId} | shop=${shopDomain}`);

  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("[Chat] ANTHROPIC_API_KEY missing from environment");
    stream.sendMessage({
      type: "error",
      error: "Anthropic API key not configured. Please add ANTHROPIC_API_KEY to environment variables."
    });
    return;
  }

  const claudeService = createClaudeService();
  const toolService = createToolService();

  let mcpApiUrl = null;
  try {
    const urlResult = await Promise.race([
      getCustomerAccountUrls(
        shopDomain,
        conversationId,
        { getCustomerAccountUrlsFromDb, storeCustomerAccountUrls }
      ),
      new Promise((resolve) => setTimeout(() => resolve({ mcpApiUrl: null }), 5000)),
    ]);
    mcpApiUrl = urlResult.mcpApiUrl;
  } catch (e) {
    console.warn("[Chat] Failed to get customer account URLs:", e.message);
  }

  const mcpClient = new MCPClient(shopDomain, conversationId, null, mcpApiUrl);

  let productsSentToFrontend = false;

  try {
    let storefrontMcpTools = [], customerMcpTools = [];
    try {
      const mcpConnectPromise = (async () => {
        const sf = await mcpClient.connectToStorefrontServer();
        const cu = await mcpClient.connectToCustomerServer();
        return { sf, cu };
      })();
      const mcpResult = await Promise.race([
        mcpConnectPromise,
        new Promise((resolve) => setTimeout(() => resolve(null), 8000)),
      ]);
      if (mcpResult) {
        storefrontMcpTools = mcpResult.sf;
        customerMcpTools = mcpResult.cu;
      }
      console.log(`Connected to MCP: ${storefrontMcpTools.length + customerMcpTools.length} tools`);

      const catalogTool = (storefrontMcpTools || []).find(t => isCatalogSearchTool(t.name));
      if (catalogTool) {
        console.log(`[Chat] MCP advertises catalog-search tool as: "${catalogTool.name}"`);
        // Log the schema so we can verify it in production
        console.log(`[Chat] catalog tool input_schema keys:`, Object.keys(catalogTool.input_schema?.properties || {}));
      } else {
        console.warn(`[Chat] WARNING: No known catalog-search tool found. Available storefront tools:`,
          (storefrontMcpTools || []).map(t => t.name).join(", "));
      }
    } catch (error) {
      console.warn("[Chat] MCP connection failed, continuing without tools:", error.message);
    }

    try {
      await saveMessage(conversationId, "user", userMessage, {
        shopDomain,
        visitorId,
      });
    } catch (dbError) {
      console.error("[Chat] Failed to save user message:", dbError.message);
    }

    let conversationHistory = [];
    try {
      const dbMessages = await getConversationHistory(conversationId);
      conversationHistory = dbMessages.map((dbMessage) => {
        let content;
        try {
          content = JSON.parse(dbMessage.content);
        } catch (e) {
          content = dbMessage.content;
        }
        return { role: dbMessage.role, content };
      });
    } catch (historyError) {
      console.error("[Chat] Failed to get conversation history:", historyError.message);
    }

    const lastMsg = conversationHistory[conversationHistory.length - 1];
    if (!lastMsg || lastMsg.role !== "user" || lastMsg.content !== userMessage) {
      conversationHistory.push({ role: "user", content: userMessage });
    }

    let finalMessage = { role: "user", content: userMessage };
    let fullResponseText = "";
    let currentAssistantMessage = null;
    let loopCount = 0;

    while (finalMessage.stop_reason !== "end_turn" && loopCount < MAX_TOOL_LOOPS) {
      loopCount++;
      currentAssistantMessage = null;

      console.log(`[Chat] Claude call #${loopCount} | history=${conversationHistory.length} messages`);

      finalMessage = await claudeService.streamConversation(
        {
          messages: conversationHistory,
          promptType,
          tools: mcpClient.tools,
        },
        {
          onText: (textDelta) => {
            fullResponseText += textDelta;
            stream.sendMessage({ type: "chunk", chunk: textDelta });
          },

          onMessage: async (message) => {
            currentAssistantMessage = message;

            let textContent = "";
            if (Array.isArray(message.content)) {
              textContent = message.content
                .filter((b) => b.type === "text")
                .map((b) => b.text)
                .join("\n\n");
            } else {
              textContent = message.content;
            }

            const responseTime = Date.now() - startTime;

            if (textContent.trim()) {
              saveMessage(conversationId, message.role, textContent, {
                contentType: "TEXT",
                responseTimeMs: responseTime,
                shopDomain,
                visitorId,
              }).catch((err) => console.error("[Chat] Error saving assistant message:", err.message));
            }

            const trackingId = visitorId || fingerprintId || conversationId;
            try {
              ChatEvents.messageReceived(trackingId, {
                conversationId,
                responseTimeMs: responseTime,
                contentLength: textContent.length,
              });
            } catch (e) {
              // Ignore analytics errors
            }

            stream.sendMessage({ type: "message_complete" });
          },

          onToolUse: async (content) => {
            const toolName = content.name;
            const toolArgs = content.input;
            const toolUseId = content.id;

            console.log(`[Chat] Tool use: ${toolName} (id=${toolUseId})`);

            const thinkingStates = {
              'search_shop_catalog': 'Searching products...',
              'search_catalog': 'Searching products...',
              'search_products': 'Searching products...',
              'update_cart': 'Adding to cart...',
              'get_cart': 'Checking availability...',
              'get_product': 'Looking up product...',
              'get_product_details': 'Looking up product details...',
            };
            stream.sendMessage({
              type: 'thinking_state',
              state: thinkingStates[toolName] || 'Thinking...'
            });

            stream.sendMessage({
              type: 'tool_use',
              tool_name: toolName,
            });

            const trackingId = visitorId || fingerprintId || conversationId;
            try {
              ChatEvents.toolCalled(trackingId, {
                conversationId,
                toolName,
                toolArgs,
              });
            } catch (e) {
              // Ignore analytics errors
            }

            let toolUseResponse;
            try {
              toolUseResponse = await mcpClient.callTool(toolName, toolArgs);
            } catch (toolError) {
              console.error(
                `[Chat] Tool call failed: ${toolName}`,
                toolError.message,
                "args:",
                JSON.stringify(toolArgs)
              );
              toolUseResponse = {
                error: { type: "tool_error", message: toolError.message, data: toolError.message },
              };
            }

            const isCatalogSearch = isCatalogSearchTool(toolName);

            if (isCatalogSearch && !toolUseResponse.error) {
              // =========================================================
              // v2.2 FIX: Extract real query string from toolArgs
              // search_catalog uses { catalog: { query: "..." } } schema
              // search_shop_catalog used { query: "..." } schema
              // NEVER use JSON.stringify(toolArgs) — it breaks the gate
              // =========================================================
              const searchQuery = extractSearchQuery(toolArgs);

              if (!searchQuery) {
                console.warn(`[Chat] Could not extract search query from toolArgs:`, JSON.stringify(toolArgs));
              } else {
                console.log(`[Chat] Extracted search query: "${searchQuery}" from toolArgs schema`);
              }

              let products = toolService.processProductSearchResult(toolUseResponse, shopDomain, userMessage, searchQuery);

              if ((!products || products.length === 0) && searchQuery) {
                console.log(`[Search] Zero relevant results for: "${searchQuery}" — going direct to Storefront API`);
                products = await tryDirectStorefrontFallback({
                  searchQuery,
                  userMessage,
                  shopDomain,
                  toolService,
                  onResultUsed: (wrappedResp) => { toolUseResponse = wrappedResp; },
                });
              }

              if ((!products || products.length === 0) && searchQuery) {
                const mcpFallback = await tryFallbackSearches(mcpClient, searchQuery, toolName);
                if (mcpFallback) {
                  products = toolService.processProductSearchResult(
                    mcpFallback.result,
                    shopDomain,
                    userMessage,
                    mcpFallback.query
                  );
                  if (products && products.length > 0) {
                    toolUseResponse = mcpFallback.result;
                    console.log(`[Search-Fallback] Recovered ${products.length} products via MCP fallback: "${mcpFallback.query}"`);
                  }
                }
              }

              if (products && products.length > 0) {
                console.log(`[Search] ${products.length} results for: "${searchQuery}"`);
                stream.sendMessage({
                  type: "product_results",
                  products: products
                });
                productsSentToFrontend = true;
              } else {
                console.log(`[Search] Zero results for: "${searchQuery}" (all fallbacks exhausted) — injecting retry hint`);
                const retryHint = JSON.stringify({
                  products: [],
                  total_count: 0,
                  _system_hint: `IMPORTANT: Zero products found for "${searchQuery}" even after automatic fallback searches. You MUST try a COMPLETELY DIFFERENT search approach. Try: 1) Just the brand name alone. 2) Just the product category alone (e.g. "circuit breaker", "sensor", "valve"). 3) A single generic keyword. Do NOT repeat similar queries. If 3 different searches all return zero, then tell the user the product may not be in our catalog and offer to connect them with our sales team.`
                });
                if (!Array.isArray(toolUseResponse.content)) {
                  toolUseResponse.content = [];
                }
                toolUseResponse.content = [{ type: "text", text: retryHint }];
              }
            }

            if (toolName === "update_cart" && !toolUseResponse.error) {
              const { processCartUpdateResult } = toolService;
              const { checkoutUrl, cart } = processCartUpdateResult(toolUseResponse);

              if (checkoutUrl) {
                stream.sendMessage({
                  type: "cart_updated",
                  checkout_url: checkoutUrl,
                  cart,
                });
              } else {
                console.warn("[Chat] update_cart succeeded but no checkout URL was found in tool response");
              }
            }

            if (currentAssistantMessage) {
              conversationHistory.push({
                role: currentAssistantMessage.role,
                content: currentAssistantMessage.content
              });
              currentAssistantMessage = null;
            }

            if (toolUseResponse.error) {
              const errorContent = {
                type: "tool_result",
                tool_use_id: toolUseId,
                content: JSON.stringify({
                  error: toolUseResponse.error.data || toolUseResponse.error,
                }),
                is_error: true,
              };

              conversationHistory.push({
                role: "user",
                content: [errorContent],
              });

              stream.sendMessage({
                type: "tool_error",
                tool_name: toolName,
                error: toolUseResponse.error.data || toolUseResponse.error,
              });
            } else {
              let toolResultContent;
              try {
                if (Array.isArray(toolUseResponse.content)) {
                  const textParts = toolUseResponse.content
                    .filter((c) => c && c.type === "text" && c.text)
                    .map((c) => c.text);
                  toolResultContent = textParts.join("\n") || "No content returned";
                } else if (typeof toolUseResponse.content === "string") {
                  toolResultContent = toolUseResponse.content;
                } else {
                  toolResultContent = JSON.stringify(toolUseResponse.content ?? "No content returned");
                }
              } catch (e) {
                console.error("[Chat] Error serializing tool result:", e.message);
                toolResultContent = "Tool returned data successfully";
              }

              const resultContent = {
                type: "tool_result",
                tool_use_id: toolUseId,
                content: toolResultContent,
              };

              conversationHistory.push({
                role: "user",
                content: [resultContent],
              });
            }

            stream.sendMessage({ type: 'new_message' });
          },

          onContentBlock: (contentBlock) => {
            if (contentBlock.type === "text") {
              stream.sendMessage({
                type: "content_block_complete",
                content_block: contentBlock
              });
            }
          },
        }
      );

      if (currentAssistantMessage) {
        conversationHistory.push({
          role: currentAssistantMessage.role,
          content: currentAssistantMessage.content
        });
        currentAssistantMessage = null;
      }

      console.log(`[Chat] Claude call #${loopCount} done | stop_reason=${finalMessage.stop_reason}`);
    }

    if (loopCount >= MAX_TOOL_LOOPS) {
      console.warn(`[Chat] Hit max tool loop limit (${MAX_TOOL_LOOPS})`);
    }

    stream.sendMessage({ type: "end_turn" });
    console.log(`[Chat] Response complete | ${Date.now() - startTime}ms`);

  } catch (error) {
    console.error("[Chat] Error in chat session:", error.message);
    console.error("[Chat] Stack:", error.stack);

    const trackingId = visitorId || fingerprintId || conversationId;
    try {
      ChatEvents.errorOccurred(trackingId, {
        conversationId,
        error: error.message,
      });
    } catch (e) {
      // Ignore analytics errors
    }

    if (productsSentToFrontend) {
      console.log("[Chat] Products already sent — sending fallback text instead of error");
      stream.sendMessage({
        type: "chunk",
        chunk: "I found several products matching your request. You can browse them above.",
      });
      stream.sendMessage({ type: "message_complete" });
      stream.sendMessage({ type: "end_turn" });
    } else {
      stream.sendMessage({
        type: "error",
        error: "Failed to get response. Please try again."
      });
    }
  }
}

async function getCustomerAccountUrls(conversationIdOrDomain, conversationId, dbHelpers) {
  try {
    const existing = await dbHelpers.getCustomerAccountUrlsFromDb(conversationId);
    if (existing) return existing;

    if (!conversationIdOrDomain) return { mcpApiUrl: null };

    const hostname = conversationIdOrDomain.includes('.')
      ? conversationIdOrDomain
      : new URL(conversationIdOrDomain).hostname;

    const fetchWithTimeout = (url, ms = 4000) => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), ms);
      return fetch(url, { signal: controller.signal })
        .then((r) => { clearTimeout(timer); return r.json(); })
        .catch(() => ({}));
    };

    const [mcpResponse, openidResponse] = await Promise.all([
      fetchWithTimeout(`https://${hostname}/.well-known/customer-account-api`),
      fetchWithTimeout(`https://${hostname}/.well-known/openid-configuration`),
    ]);

    const response = {
      mcpApiUrl: mcpResponse.mcp_api || null,
      authorizationUrl: openidResponse.authorization_endpoint || null,
      tokenUrl: openidResponse.token_endpoint || null,
    };

    await dbHelpers.storeCustomerAccountUrls({
      conversationId,
      ...response,
    }).catch((e) => console.warn("Failed to store URLs:", e));

    return response;
  } catch (error) {
    console.error("Error getting customer MCP API URL:", error);
    return { mcpApiUrl: null };
  }
}

function getCorsHeaders(request) {
  const origin = request.headers.get("Origin");
  const allowOrigin = origin || "*";
  return {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Accept, X-Shopify-Shop-Id",
    "Access-Control-Max-Age": "86400",
    ...(origin ? { "Access-Control-Allow-Credentials": "true" } : {}),
  };
}

function getSseHeaders(request) {
  const origin = request.headers.get("Origin");
  const allowOrigin = origin || "*";
  return {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    "Connection": "keep-alive",
    "X-Accel-Buffering": "no",
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Accept, X-Shopify-Shop-Id",
    ...(origin ? { "Access-Control-Allow-Credentials": "true" } : {}),
  };
}
