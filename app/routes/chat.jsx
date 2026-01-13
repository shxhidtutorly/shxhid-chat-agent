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
  Core chat session
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
      // Pass visitorId to ensure Visitor record is created/linked
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

    // IMPORTANT: Buffer tool results to save them AFTER the assistant message
    // This prevents the "unexpected tool_result" error by ensuring correct order
    let toolResultsBuffer = [];

    while (finalMessage.stop_reason !== "end_turn") {
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

          onToolUse: async (content) => {
            const toolName = content.name;
            const toolArgs = content.input;
            
            stream.sendMessage({
              type: "tool_use",
              tool_use_message: `Calling tool: ${toolName}`,
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
              console.warn("Analytics failed:", e);
            }

            // Call the tool
            const toolUseResponse = await mcpClient.callTool(toolName, toolArgs);

            // Handle errors or success for the UI stream
            if (toolUseResponse.error) {
                // We use the service just for formatting logic/logging if needed, 
                // but we will handle the SAVING manually below to preserve order.
                if(toolUseResponse.error.type === 'auth_required') {
                    stream.sendMessage({ type: 'auth_required' });
                }
            } else {
                 // Check if this is a product search result to help the UI
                if (toolName === "search_shop_catalog" && toolService.processProductSearchResult) {
                    // FIX: Pass shopDomain so we can generate valid absolute URLs
                    toolService.processProductSearchResult(toolUseResponse, shopDomain);
                }
            }

            // Prepare the tool result message
            const resultContent = toolUseResponse.error ? (toolUseResponse.error.data || "Error") : toolUseResponse.content;
            
            const toolResultMessage = {
              role: 'user',
              content: [{
                type: "tool_result",
                tool_use_id: content.id,
                content: resultContent
              }]
            };

            // Add to buffer - DO NOT SAVE TO DB YET
            toolResultsBuffer.push(toolResultMessage);

            stream.sendMessage({ type: "new_message" });
          },

          onMessage: async (message) => {
            // 1. Update in-memory history
            conversationHistory.push({ role: message.role, content: message.content });

            const responseTime = Date.now() - startTime;
            
            // 2. Determine content to save
            // FIX: If message contains tool_use, we MUST save the full JSON structure
            let contentToSave = message.content;
            let contentType = "TEXT";

            if (Array.isArray(message.content)) {
                // If it contains tools, save as JSON
                if (message.content.some(b => b.type === 'tool_use')) {
                    contentToSave = JSON.stringify(message.content);
                    contentType = "JSON";
                } else {
                     // Otherwise just extract text to keep DB clean
                    contentToSave = message.content
                        .filter((b) => b.type === "text")
                        .map((b) => b.text)
                        .join("\n\n");
                }
            }

            // 3. Save Assistant Message FIRST
            await saveMessage(conversationId, message.role, contentToSave, {
              contentType,
              responseTimeMs: responseTime,
              shopDomain,
              visitorId,
            }).catch((err) => console.error("Error saving assistant message:", err));

            // 4. Save Buffered Tool Results SECOND
            // This guarantees the DB has Assistant(Request) -> User(Result)
            if (toolResultsBuffer.length > 0) {
                for (const resMsg of toolResultsBuffer) {
                    conversationHistory.push(resMsg); // Update memory
                    
                    await saveMessage(conversationId, 'user', JSON.stringify(resMsg.content), {
                        contentType: "JSON",
                        shopDomain,
                        visitorId
                    }).catch(err => console.error("Error saving tool result:", err));
                }
                toolResultsBuffer = []; // Clear buffer
            }

            // Track analytics
            const trackingId = visitorId || fingerprintId || conversationId;
            try {
              ChatEvents.messageReceived(trackingId, {
                conversationId,
                responseTimeMs: responseTime,
                contentLength: fullResponseText.length,
              });
            } catch (e) {
              console.warn("Analytics failed:", e);
            }

            stream.sendMessage({ type: "message_complete" });
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
