// app/routes/chat.jsx
/**
 * Chat API Route — server-only code must be dynamically imported
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

  if (url.searchParams.has("history") && url.searchParams.has("conversation_id")) {
    return handleHistoryRequest(request, url.searchParams.get("conversation_id"));
  }

  if (!url.searchParams.has("history") && request.headers.get("Accept") === "text/event-stream") {
    return handleChatRequest(request);
  }

  return new Response(
    JSON.stringify({ error: "API endpoint only supports history or SSE" }),
    { status: 400, headers: getCorsHeaders(request) }
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
    // server-only import
    const dbMod = await import("../db.server");
    const getConversationHistory = dbMod.getConversationHistory;

    const messages = await getConversationHistory(conversationId);

    const cleanedMessages = messages.map((msg) => {
      let parsedContent = msg.content;
      try {
        const parsed = JSON.parse(msg.content);
        if (Array.isArray(parsed)) {
          const textBlocks = parsed
            .filter((block) => block.type === "text")
            .map((block) => block.text)
            .join("\n\n");
          parsedContent = textBlocks || msg.content;
        } else if (parsed.text) {
          parsedContent = parsed.text;
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
      headers: getCorsHeaders(request),
    });
  } catch (error) {
    console.error("Error fetching history:", error);
    return new Response(JSON.stringify({ messages: [], error: "Failed to fetch history" }), {
      headers: getCorsHeaders(request),
    });
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
        { status: 400, headers: getSseHeaders(request) }
      );
    }

    const conversationId = body.conversation_id || Date.now().toString();
    const promptType = body.prompt_type || "default";

    // Server-only imports used inside the handler
    const dbMod = await import("../db.server");
    const {
      saveMessage,
      getConversationHistory,
      storeCustomerAccountUrls,
      getCustomerAccountUrls: getCustomerAccountUrlsFromDb,
      createOrUpdateConversation,
      trackAnalyticsEvent,
      endConversation,
      getCustomerAccountUrls: dbGetCustomerAccountUrls,
    } = dbMod;

    const posthogMod = await import("../services/posthog.server");
    const ChatEvents = posthogMod.ChatEvents;

    const appConfigMod = await import("../services/config.server");
    const AppConfig = appConfigMod.default ?? appConfigMod;

    const streamMod = await import("../services/streaming.server");
    const createSseStream = streamMod.createSseStream;

    const claudeMod = await import("../services/claude.server");
    const createClaudeService = claudeMod.createClaudeService;

    const toolMod = await import("../services/tool.server");
    const createToolService = toolMod.createToolService;

    const MCPClientMod = await import("../mcp-client");
    const MCPClient = MCPClientMod.default ?? MCPClientMod;

    // Track analytics: message sent
    const shopDomain = request.headers.get("Origin");
    const trackingId = visitorId || fingerprintId || conversationId;
    ChatEvents.messageSent(trackingId, {
      conversationId,
      shopDomain,
      messageLength: userMessage.length,
    });

    // create SSE stream that calls handleChatSession
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
        // pass server helpers to reduce repeated imports
        helpers: {
          saveMessage,
          getConversationHistory,
          getCustomerAccountUrlsFromDb,
          storeCustomerAccountUrls,
          ChatEvents,
          createClaudeService,
          createToolService,
          MCPClient,
          AppConfig,
        },
      });
    });

    return new Response(responseStream, {
      headers: getSseHeaders(request),
    });
  } catch (error) {
    console.error("Error in chat request handler:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: getCorsHeaders(request),
    });
  }
}

/* ------------------------
  Core chat session (server-only)
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

  // Unpack helpers (these are server functions/clients)
  const {
    saveMessage,
    getConversationHistory,
    getCustomerAccountUrlsFromDb,
    storeCustomerAccountUrls,
    ChatEvents,
    createClaudeService,
    createToolService,
    MCPClient,
    AppConfig,
  } = helpers;

  const claudeService = createClaudeService();
  const toolService = createToolService();

  // Get or resolve MCP URL (server-only function)
  const { mcpApiUrl } = await getCustomerAccountUrls(shopDomain, conversationId, {
    getCustomerAccountUrlsFromDb,
    storeCustomerAccountUrls,
  });

  const mcpClient = new MCPClient(shopDomain, conversationId, null, mcpApiUrl);

  try {
    stream.sendMessage({ type: "id", conversation_id: conversationId });

    // attempt connecting to MCP (best-effort)
    let storefrontMcpTools = [], customerMcpTools = [];
    try {
      storefrontMcpTools = await mcpClient.connectToStorefrontServer();
      customerMcpTools = await mcpClient.connectToCustomerServer();
      console.log(`Connected to MCP with ${storefrontMcpTools.length + customerMcpTools.length} tools`);
    } catch (error) {
      console.warn("Failed to connect to MCP servers, continuing without tools:", error?.message);
    }

    // Save user's message
    await saveMessage(conversationId, "user", userMessage, {
      shopDomain: shopDomain ? new URL(shopDomain).hostname : null,
      visitorId,
    });

    // Fetch conversation messages and format for LLM
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

    // Stream conversation from Claude
    let finalMessage = { role: "user", content: userMessage };
    let fullResponseText = "";

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

          onMessage: async (message) => {
            conversationHistory.push({ role: message.role, content: message.content });

            // extract text blocks
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
            await saveMessage(conversationId, message.role, textContent, {
              contentType: "TEXT",
              responseTimeMs: responseTime,
              shopDomain: shopDomain ? new URL(shopDomain).hostname : null,
              visitorId,
            }).catch((err) => console.error("Error saving message:", err));

            const trackingId = visitorId || fingerprintId || conversationId;
            ChatEvents.messageReceived(trackingId, {
              conversationId,
              responseTimeMs: responseTime,
              contentLength: textContent.length,
            });

            stream.sendMessage({ type: "message_complete" });
          },

          onToolUse: async (content) => {
            const toolName = content.name;
            const toolArgs = content.input;
            const toolUseId = content.id;

            stream.sendMessage({
              type: "tool_use",
              tool_use_message: `Calling tool: ${toolName}`,
              tool_name: toolName,
            });

            const trackingId = visitorId || fingerprintId || conversationId;
            ChatEvents.toolCalled(trackingId, {
              conversationId,
              toolName,
              toolArgs,
            });

            const toolUseResponse = await mcpClient.callTool(toolName, toolArgs);

            if (toolUseResponse.error) {
              await toolService.handleToolError(
                toolUseResponse,
                toolName,
                toolUseId,
                conversationHistory,
                stream.sendMessage,
                conversationId
              );
            } else {
              await toolService.handleToolSuccess(
                toolUseResponse,
                toolName,
                toolUseId,
                conversationHistory,
                [], // productsToDisplay handled inside toolService
                conversationId
              );
            }

            stream.sendMessage({ type: "new_message" });
          },

          onContentBlock: (contentBlock) => {
            if (contentBlock.type === "text") {
              stream.sendMessage({ type: "content_block_complete", content_block: contentBlock });
            }
          },
        }
      );
    }

    stream.sendMessage({ type: "end_turn" });

    // product results & analytics tracking would go here if needed

  } catch (error) {
    console.error("Error in chat session:", error);
    const trackingId = visitorId || fingerprintId || conversationId;
    try {
      ChatEvents.errorOccurred(trackingId, {
        conversationId,
        error: error?.message,
      });
    } catch (e) {
      /* ignore posthog failures */
    }
    throw error;
  }
}

/* ------------------------
   Utilities
   ------------------------ */
async function getCustomerAccountUrls(conversationIdOrDomain, conversationId, dbHelpers) {
  // dbHelpers contains getCustomerAccountUrlsFromDb and storeCustomerAccountUrls
  try {
    const existing = await dbHelpers.getCustomerAccountUrlsFromDb(conversationId);
    if (existing) return existing;

    if (!conversationIdOrDomain) return { mcpApiUrl: null };

    const hostname = new URL(conversationIdOrDomain).hostname;
    const [mcpResponse, openidResponse] = await Promise.all([
      fetch(`https://${hostname}/.well-known/customer-account-api`).then((r) => r.json()).catch(() => ({})),
      fetch(`https://${hostname}/.well-known/openid-configuration`).then((r) => r.json()).catch(() => ({})),
    ]);

    const response = {
      mcpApiUrl: mcpResponse.mcp_api || null,
      authorizationUrl: openidResponse.authorization_endpoint || null,
      tokenUrl: openidResponse.token_endpoint || null,
    };

    await dbHelpers.storeCustomerAccountUrls({
      conversationId,
      mcpApiUrl: response.mcpApiUrl,
      authorizationUrl: response.authorizationUrl,
      tokenUrl: response.tokenUrl,
    }).catch(() => {});

    return response;
  } catch (error) {
    console.error("Error getting customer MCP API URL:", error);
    return { mcpApiUrl: null };
  }
}

function getCorsHeaders(request) {
  const origin = request.headers.get("Origin") || "*";
  const requestHeaders = request.headers.get("Access-Control-Request-Headers") || "Content-Type, Accept";
  return {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": requestHeaders,
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
    "Access-Control-Allow-Methods": "GET,OPTIONS,POST",
    "Access-Control-Allow-Headers": "X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, X-Shopify-Shop-Id",
  };
}
