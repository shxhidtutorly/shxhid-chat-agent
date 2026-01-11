// app/services/claude.server.js
import Anthropic from "@anthropic-ai/sdk";

/**
 * Create Claude service instance
 */
export function createClaudeService() {
  // CRITICAL: Check API key exists
  const apiKey = process.env.ANTHROPIC_API_KEY;
  
  if (!apiKey) {
    console.error("❌ ANTHROPIC_API_KEY not found in environment variables!");
    throw new Error("ANTHROPIC_API_KEY is not configured");
  }

  console.log("✅ Claude API Key found:", apiKey.substring(0, 10) + "...");

  const client = new Anthropic({
    apiKey: apiKey,
  });

  return {
    /**
     * Stream a conversation with Claude
     */
    async streamConversation(config, callbacks) {
      const { messages, promptType = "standardAssistant", tools = [] } = config;
      const { onText, onMessage, onToolUse, onContentBlock } = callbacks;

      try {
        // Build system prompt
        const systemPrompt = getSystemPrompt(promptType);

        // Prepare API call parameters
        const apiParams = {
          model: "claude-sonnet-4-20250514",
          max_tokens: 4096,
          system: systemPrompt,
          messages: messages,
          stream: true,
        };

        // Add tools if available
        if (tools && tools.length > 0) {
          apiParams.tools = tools;
        }

        console.log("🤖 Calling Claude API...");

        // Create stream
        const stream = await client.messages.stream(apiParams);

        let currentMessage = {
          role: "assistant",
          content: [],
          stop_reason: null,
        };

        // Handle stream events
        stream.on("text", (textDelta) => {
          if (onText) onText(textDelta);
        });

        stream.on("message_start", () => {
          console.log("📨 Message started");
        });

        stream.on("content_block_start", (event) => {
          console.log("🔷 Content block started:", event.content_block.type);
        });

        stream.on("content_block_delta", (event) => {
          if (event.delta.type === "text_delta") {
            if (onText) onText(event.delta.text);
          }
        });

        stream.on("content_block_stop", (event) => {
          if (onContentBlock) onContentBlock(event.content_block);
        });

        stream.on("message_delta", (event) => {
          if (event.delta.stop_reason) {
            currentMessage.stop_reason = event.delta.stop_reason;
          }
        });

        stream.on("message_stop", () => {
          console.log("✅ Message completed");
        });

        // Wait for stream to complete
        const finalMessage = await stream.finalMessage();

        // Process final message
        currentMessage.content = finalMessage.content;
        currentMessage.stop_reason = finalMessage.stop_reason;

        // Handle tool uses
        const toolUses = finalMessage.content.filter((c) => c.type === "tool_use");
        
        for (const toolUse of toolUses) {
          if (onToolUse) {
            await onToolUse(toolUse);
          }
        }

        // Call onMessage callback
        if (onMessage) {
          await onMessage(currentMessage);
        }

        return currentMessage;

      } catch (error) {
        console.error("❌ Claude API Error:", error);
        
        // Check if it's an API key error
        if (error.message?.includes("api_key") || error.status === 401) {
          throw new Error("Invalid Anthropic API key. Please check your ANTHROPIC_API_KEY environment variable.");
        }
        
        throw error;
      }
    },
  };
}

/**
 * Get system prompt based on type
 */
function getSystemPrompt(promptType) {
  const prompts = {
    standardAssistant: `You are a helpful AI shopping assistant for a Shopify store. You help customers:
- Find products they're looking for
- Answer questions about products, shipping, and policies
- Add items to their cart
- Track their orders
- Process returns and exchanges

Be friendly, concise, and helpful. Always prioritize the customer's needs.`,

    productExpert: `You are a product expert for this Shopify store. You have deep knowledge about all products and can:
- Recommend products based on customer needs
- Compare different products
- Explain product features and benefits
- Suggest complementary items

Be enthusiastic but honest about products.`,

    supportAgent: `You are a customer support agent. Your role is to:
- Resolve customer issues quickly
- Answer questions about orders, shipping, and returns
- Handle complaints professionally
- Escalate complex issues when needed

Be patient, empathetic, and solution-focused.`,
  };

  return prompts[promptType] || prompts.standardAssistant;
}
