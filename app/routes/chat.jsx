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
  This properly handles the conversation flow for Claude API
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

  // Check for Anthropic API key
  if (!process.env.ANTHROPIC_API_KEY) {
    stream.sendMessage({ 
      type: "error", 
      error: "Anthropic API key not configured. Please add ANTHROPIC_API_KEY to environment variables." 
    });
    return;
  }

  const claudeService = createClaudeService();
  const toolService = createToolService();

  // Get MCP URL
  const { mcpApiUrl } = await getCustomerAccountUrls(
    shopDomain, 
    conversationId, 
    { getCustomerAccountUrlsFromDb, storeCustomerAccountUrls }
  );

  const mcpClient = new MCPClient(shopDomain, conversationId, null, mcpApiUrl);

  try {
    stream.sendMessage({ type: "id", conversation_id: conversationId });

    // Connect to MCP (best-effort)
    let storefrontMcpTools = [], customerMcpTools = [];
    try {
      storefrontMcpTools = await mcpClient.connectToStorefrontServer();
      customerMcpTools = await mcpClient.connectToCustomerServer();
      console.log(`Connected to MCP: ${storefrontMcpTools.length + customerMcpTools.length} tools`);
    } catch (error) {
      console.warn("MCP connection failed, continuing without tools:", error.message);
    }

    // Save user message
    try {
      await saveMessage(conversationId, "user", userMessage, {
        shopDomain,
        visitorId,
      });
    } catch (dbError) {
      console.error("Failed to save user message:", dbError);
    }

    // Get conversation history
    const dbMessages = await getConversationHistory(conversationId);
    let conversationHistory = dbMessages.map((dbMessage) => {
      let content;
      try {
        content = JSON.parse(dbMessage.content);
      } catch (e) {
        content = dbMessage.content;
      }
      return { role: dbMessage.role, content };
    });

    // Stream from Claude
    let finalMessage = { role: "user", content: userMessage };
    let fullResponseText = "";
    let currentAssistantMessage = null;

    while (finalMessage.stop_reason !== "end_turn") {
      // Reset for each turn
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
            // ✅ Store the message but DON'T add to history yet
            // We'll add it after all tool uses are processed
            currentAssistantMessage = message;

            // Extract text content for saving to database and streaming
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
              }).catch((err) => console.error("Error saving assistant message:", err));
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
              console.warn("Analytics failed:", e);
            }

            stream.sendMessage({ type: "message_complete" });
          },

           onToolUse: async (content) => {
  const toolName = content.name;
  const toolArgs = content.input;
  const toolUseId = content.id;

  const toolUseMessage = `Calling tool: ${toolName} with arguments: ${JSON.stringify(toolArgs)}`;

  stream.sendMessage({
    type: 'tool_use',
    tool_use_message: toolUseMessage
  });

  const trackingId = visitorId || fingerprintId || conversationId;
  try {
    ChatEvents.toolCalled(trackingId, {
      conversationId,
      toolName,
      toolArgs,
    });
  } catch (e) {
    console.warn("Analytics failed:", e);
  }

  // Call the tool
  const toolUseResponse = await mcpClient.callTool(toolName, toolArgs);

  // ✅ ENHANCED: Process and send products to frontend
  if (toolName === "search_shop_catalog" && !toolUseResponse.error) {
    const products = toolService.processProductSearchResult(toolUseResponse, shopDomain);
    
    if (products && products.length > 0) {
      console.log(`📦 Sending ${products.length} products to frontend`);
      
      // Send products to frontend for display
      stream.sendMessage({
        type: "product_results",
        products: products,
        count: products.length
      });

      // ✅ CRITICAL: Modify the tool response to prevent Claude from being verbose
      // Replace the detailed product list with a concise summary
      if (toolUseResponse.content && toolUseResponse.content.length > 0) {
        const summary = toolService.createProductSummary(products);
        toolUseResponse.content = [{
          type: "text",
          text: JSON.stringify({
            status: "success",
            product_count: summary.product_count,
            message: "Products have been displayed in the UI with images and add-to-cart buttons. Keep your response very brief - just acknowledge the results in 1-2 sentences maximum."
          })
        }];
      }
    }
  }

  // Add assistant message to history FIRST
  if (currentAssistantMessage) {
    conversationHistory.push({
      role: currentAssistantMessage.role,
      content: currentAssistantMessage.content
    });
    currentAssistantMessage = null;
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
    const resultContent = {
      type: "tool_result",
      tool_use_id: toolUseId,
      content: toolUseResponse.content || [],
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

      // ✅ If no tools were used, add the assistant message to history now
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
    
    const trackingId = visitorId || fingerprintId || conversationId;
    try {
      ChatEvents.errorOccurred(trackingId, {
        conversationId,
        error: error.message,
      });
    } catch (e) {
      // Ignore analytics errors
    }

    stream.sendMessage({ 
      type: "error", 
      error: "Failed to get response from Claude. Please try again." 
    });
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

    const [mcpResponse, openidResponse] = await Promise.all([
      fetch(`https://${hostname}/.well-known/customer-account-api`)
        .then((r) => r.json())
        .catch(() => ({})),
      fetch(`https://${hostname}/.well-known/openid-configuration`)
        .then((r) => r.json())
        .catch(() => ({})),
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
