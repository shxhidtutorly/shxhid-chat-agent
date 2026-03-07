// app/routes/chat.jsx
/**
 * Chat API Route - FIXED VERSION
 * Fixes: 
 * 1. P2025 (Visitor ID errors)
 * 2. invalid_request_error (Tool Use Order/Data Loss)
 * 3. Broken Product URLs & Images (Passes shopDomain to tool processor)
 */

export async function loader({ request }) {
  // Handle OPTIONS (CORS preflight)
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: getCorsHeaders(request),
    });
  }

  const url = new URL(request.url);

  // History request
  if (url.searchParams.has("history") && url.searchParams.has("conversation_id")) {
    return handleHistoryRequest(request, url.searchParams.get("conversation_id"));
  }

  // SSE streaming request
  if (url.searchParams.has("stream") || request.headers.get("Accept")?.includes("text/event-stream")) {
    return handleChatRequest(request);
  }

  // Default response
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
  // Handle CORS preflight — belt-and-suspenders for servers that route OPTIONS to action()
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: getCorsHeaders(request),
    });
  }
  return handleChatRequest(request);
}

/* ------------------------
   Helper: history handler
   ------------------------ */
async function handleHistoryRequest(request, conversationId) {
  try {
    const dbMod = await import("../db.server");
    const getConversationHistory = dbMod.getConversationHistory;

    const messages = await getConversationHistory(conversationId);

    const cleanedMessages = messages.map((msg) => {
      let parsedContent = msg.content;
      try {
        const parsed = JSON.parse(msg.content);
        // If the content is an array (likely rich content with tools), keep it as JSON
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

/* ------------------------
   Helper: chat / SSE handler
   ------------------------ */
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

    // Server-only imports
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

    // Get shop domain from request
    // Priority: 1) Shopify app proxy ?shop= param  2) POST body shop_domain  3) Origin header  4) env var fallback
    const reqUrl = new URL(request.url);
    const shopFromProxy = reqUrl.searchParams.get("shop"); // Shopify app proxy adds this
    const shopFromBody = body.shop_domain || null; // Direct connection sends this
    const origin = request.headers.get("Origin");
    const shopFromOrigin = origin ? new URL(origin).hostname : null;
    const shopDomain = shopFromProxy || shopFromBody || shopFromOrigin || process.env.SHOPIFY_STORE_DOMAIN || null;

    if (!shopDomain) {
      console.warn('[Chat] Could not resolve shop domain from request');
    }

    const trackingId = visitorId || fingerprintId || conversationId;

    // Track analytics
    try {
      ChatEvents.messageSent(trackingId, {
        conversationId,
        shopDomain,
        messageLength: userMessage.length,
      });
    } catch (e) {
      console.warn("Analytics tracking failed:", e);
    }

    // Create SSE stream
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

/* ------------------------
  Core chat session
  Handles the conversation flow for Claude API with tool use loop
  ------------------------ */
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
  const MAX_TOOL_LOOPS = 6;

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

  // Send conversation ID immediately — establishes the SSE connection for the client
  stream.sendMessage({ type: "id", conversation_id: conversationId });

  console.log(`[Chat] New request | conversation=${conversationId} | shop=${shopDomain}`);

  // Check for Anthropic API key
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

  // Get MCP URL (with timeout to prevent hanging)
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

  // Track whether products were already sent to the frontend
  let productsSentToFrontend = false;

  try {
    // Connect to MCP (best-effort, with timeout)
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
    } catch (error) {
      console.warn("[Chat] MCP connection failed, continuing without tools:", error.message);
    }

    // Save user message
    try {
      await saveMessage(conversationId, "user", userMessage, {
        shopDomain,
        visitorId,
      });
    } catch (dbError) {
      console.error("[Chat] Failed to save user message:", dbError.message);
    }

    // Get conversation history
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

    // Ensure user message is in history even if DB save or read failed
    const lastMsg = conversationHistory[conversationHistory.length - 1];
    if (!lastMsg || lastMsg.role !== "user" || lastMsg.content !== userMessage) {
      conversationHistory.push({ role: "user", content: userMessage });
    }

    // Stream from Claude with tool-use loop
    let finalMessage = { role: "user", content: userMessage };
    let fullResponseText = "";
    let currentAssistantMessage = null;
    let loopCount = 0;

    while (finalMessage.stop_reason !== "end_turn" && loopCount < MAX_TOOL_LOOPS) {
      loopCount++;
      // Reset for each turn
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
            // Store the message but DON'T add to history yet
            // We'll add it after all tool uses are processed
            currentAssistantMessage = message;

            // Extract text content for saving to database
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

            // Save message to database (non-blocking) - only if there's text
            if (textContent.trim()) {
              saveMessage(conversationId, message.role, textContent, {
                contentType: "TEXT",
                responseTimeMs: responseTime,
                shopDomain,
                visitorId,
              }).catch((err) => console.error("[Chat] Error saving assistant message:", err.message));
            }

            // Track analytics (non-blocking)
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

            // Send dynamic thinking state to frontend
            const thinkingStates = {
              'search_shop_catalog': 'Searching products...',
              'update_cart': 'Adding to cart...',
              'get_cart': 'Checking availability...',
              'get_product': 'Looking up product...',
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
              console.error(`[Chat] Tool call failed: ${toolName}`, toolError.message);
              toolUseResponse = {
                error: { type: "tool_error", message: toolError.message, data: toolError.message },
              };
            }

            // Process and send products to frontend
            if (toolName === "search_shop_catalog" && !toolUseResponse.error) {
              const searchQuery = toolArgs?.query || toolArgs?.searchQuery || JSON.stringify(toolArgs);
              const products = toolService.processProductSearchResult(toolUseResponse, shopDomain, userMessage, searchQuery);

              if (products && products.length > 0) {
                console.log(`[Search] ${products.length} results for: "${searchQuery}"`);
                stream.sendMessage({
                  type: "product_results",
                  products: products
                });
                productsSentToFrontend = true;
              } else {
                // Zero results — inject retry hint so Claude retries with broader query
                console.log(`[Search] Zero results for: "${searchQuery}" — injecting retry hint`);
                const retryHint = JSON.stringify({
                  products: [],
                  total_count: 0,
                  _system_hint: "IMPORTANT: Zero products found for this query. You MUST immediately retry with a simpler, broader search query. Remove all technical specifications, material details, voltage ratings, category prefixes, and adjectives. Use ONLY the core product name or brand name. For example: if you searched 'ABB ACS580 variable frequency drive 3-phase 480V', retry with just 'ACS580'. If you searched 'Schneider 100A MCB circuit breaker', retry with 'Schneider MCB'. Try at least one more search before telling the user no results were found."
                });
                toolUseResponse.content = [{ type: "text", text: retryHint }];
              }
            }

            // Process cart updates (update_cart) and surface checkout URL to UI
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

            // Add assistant message to history FIRST (required by Claude API: assistant before tool_result)
            if (currentAssistantMessage) {
              conversationHistory.push({
                role: currentAssistantMessage.role,
                content: currentAssistantMessage.content
              });
              currentAssistantMessage = null; // Mark as added
            }

            // Then add tool_result to conversation history
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
              // Safely convert tool content to a string to avoid format issues with Claude API
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

            // Signal new message to client
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

      // If no tools were used, add the assistant message to history now
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

    // If products were already sent to the frontend, send a fallback message
    // instead of an error so the user still sees the product results
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
/* ------------------------
   Get customer URLs helper
   ------------------------ */
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

/* ------------------------
   CORS Headers
   ------------------------ */
function getCorsHeaders(request) {
  const origin = request.headers.get("Origin");
  // For app proxy requests there's no Origin — use wildcard
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
