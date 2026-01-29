// app/routes/chat.jsx
/**
 * Chat API Route - FIXED VERSION
 * Fixes: 
 * 1. P2025 (Visitor ID errors)
 * 2. invalid_request_error (Tool Use Order/Data Loss)
 * 3. Broken Product URLs & Images (Passes shopDomain to tool processor)
 * 4. Anthropic 400 "Input should be a valid list" (Proper history formatting)
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
        cart: "POST /api/cart",
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
        if (Array.isArray(parsed)) {
          parsedContent = parsed;
        } else {
          // Wrap string/object in text block for consistency
          parsedContent = [{ type: "text", text: typeof parsed === 'string' ? parsed : JSON.stringify(parsed) }];
        }
      } catch (e) {
        parsedContent = [{ type: "text", text: msg.content }];
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
    const origin = request.headers.get("Origin");
    const shopDomain = origin ? new URL(origin).hostname : null;
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
  Core chat session - FINAL WORKING VERSION
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

  if (!process.env.ANTHROPIC_API_KEY) {
    stream.sendMessage({ 
      type: "error", 
      error: "Anthropic API key not configured. Please add ANTHROPIC_API_KEY to environment variables." 
    });
    return;
  }

  const claudeService = createClaudeService();
  const toolService = createToolService();

  const { mcpApiUrl } = await getCustomerAccountUrls(
    shopDomain, 
    conversationId, 
    { getCustomerAccountUrlsFromDb, storeCustomerAccountUrls }
  );

  const mcpClient = new MCPClient(shopDomain, conversationId, null, mcpApiUrl);

  try {
    stream.sendMessage({ type: "id", conversation_id: conversationId });

    try {
      // Connect best-effort
      await mcpClient.connectToStorefrontServer();
      await mcpClient.connectToCustomerServer();
    } catch (error) {
      console.warn("MCP connection failed, continuing without tools:", error.message);
    }

    // 1. Save user message (formatted for Claude)
    // We save the simple text for readability, but history hydration will wrap it.
    try {
      await saveMessage(conversationId, "user", userMessage, {
        shopDomain,
        visitorId,
      });
    } catch (dbError) {
      console.error("Failed to save user message:", dbError);
    }

    // 2. Load and Format History correctly for Claude 3
    const dbMessages = await getConversationHistory(conversationId);
    let conversationHistory = dbMessages.map((dbMessage) => {
      try {
        const parsed = JSON.parse(dbMessage.content);
        // If it's already a valid array of blocks, use it
        if (Array.isArray(parsed)) {
          return { role: dbMessage.role, content: parsed };
        }
        // If it's just a JSON string/object but not array, wrap it
        return { role: dbMessage.role, content: [{ type: "text", text: JSON.stringify(parsed) }] };
      } catch (e) {
        // If it's a plain string (like from earlier saves), wrap in text block
        return { role: dbMessage.role, content: [{ type: "text", text: dbMessage.content }] };
      }
    });

    let finalMessage = { role: "user", content: userMessage };
    let fullResponseText = "";
    let currentAssistantMessage = null;

    while (finalMessage.stop_reason !== "end_turn") {
      currentAssistantMessage = null;
      
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

            const responseTime = Date.now() - startTime;

            // ✅ CRITICAL: Save the FULL message content (including tool_use blocks)
            // serialized as JSON. This ensures next turn has context.
            const serializedContent = JSON.stringify(message.content);

            saveMessage(conversationId, message.role, serializedContent, {
              contentType: "JSON", // Mark as JSON
              responseTimeMs: responseTime,
              shopDomain,
              visitorId,
            }).catch((err) => console.error("Error saving assistant message:", err));

            // Analytics
            try {
              const textLen = typeof fullResponseText === 'string' ? fullResponseText.length : 0;
              ChatEvents.messageReceived(visitorId || fingerprintId, {
                conversationId,
                responseTimeMs: responseTime,
                contentLength: textLen,
              });
            } catch (e) {}

            stream.sendMessage({ type: "message_complete" });
          },

          onToolUse: async (content) => {
            const toolName = content.name;
            const toolArgs = content.input;
            const toolUseId = content.id;

            const toolUseMessage = `Calling tool: ${toolName}`;
            stream.sendMessage({
              type: 'tool_use',
              tool_use_message: toolUseMessage
            });

            // Track
            try {
              ChatEvents.toolCalled(visitorId || fingerprintId, {
                conversationId,
                toolName,
                toolArgs,
              });
            } catch (e) {}

            // Call tool
            const toolUseResponse = await mcpClient.callTool(toolName, toolArgs);

            // Handle product results specifically for UI
            if (toolName === "search_shop_catalog" && !toolUseResponse.error) {
              const products = toolService.processProductSearchResult(toolUseResponse, shopDomain);
              
              if (products && products.length > 0) {
                stream.sendMessage({
                  type: "product_results",
                  products: products,
                  count: products.length
                });

                // Summary for Claude to save tokens
                if (toolUseResponse.content && toolUseResponse.content.length > 0) {
                  const summary = toolService.createProductSummary(products);
                  toolUseResponse.content = [{
                    type: "text",
                    text: JSON.stringify({
                      status: "success",
                      product_count: summary.product_count,
                      message: "Products displayed in UI. Briefly acknowledge."
                    })
                  }];
                }
              }
            }

            // Update local history for current loop
            if (currentAssistantMessage) {
              conversationHistory.push({
                role: currentAssistantMessage.role,
                content: currentAssistantMessage.content
              });
              currentAssistantMessage = null;
            }

            // Prepare result content
            let resultContent;
            if (toolUseResponse.error) {
              resultContent = {
                type: "tool_result",
                tool_use_id: toolUseId,
                content: JSON.stringify({ error: toolUseResponse.error.data || toolUseResponse.error }),
                is_error: true,
              };
              stream.sendMessage({
                type: "tool_error",
                tool_name: toolName,
                error: toolUseResponse.error.data || toolUseResponse.error,
              });
            } else {
              resultContent = {
                type: "tool_result",
                tool_use_id: toolUseId,
                content: toolUseResponse.content || [],
              };
            }

            // ✅ CRITICAL: Save the tool result to DB so history remains valid
            const toolResultMsg = [resultContent];
            saveMessage(conversationId, "user", JSON.stringify(toolResultMsg), {
              contentType: "JSON",
              toolName: toolName,
              shopDomain,
              visitorId
            }).catch(e => console.error("Failed to save tool result:", e));

            conversationHistory.push({
              role: "user",
              content: toolResultMsg,
            });

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
    }

    stream.sendMessage({ type: "end_turn" });

  } catch (error) {
    console.error("Error in chat session:", error);
    stream.sendMessage({ 
      type: "error", 
      error: "Failed to get response. Please try again." 
    });
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

    const [mcpResponse, openidResponse] = await Promise.all([
      fetch(`https://${hostname}/.well-known/customer-account-api`).then(r => r.json()).catch(() => ({})),
      fetch(`https://${hostname}/.well-known/openid-configuration`).then(r => r.json()).catch(() => ({})),
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
  const origin = request.headers.get("Origin") || "*";
  return {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Accept, X-Shopify-Shop-Id",
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Max-Age": "86400",
  };
}

function getSseHeaders(request) {
  const origin = request.headers.get("Origin") || "*";
  return {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    "Connection": "keep-alive",
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Accept, X-Shopify-Shop-Id",
  };
}
