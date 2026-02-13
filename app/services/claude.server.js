// app/services/claude.server.js
import Anthropic from "@anthropic-ai/sdk";

export function createClaudeService() {
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
    async streamConversation(config, callbacks) {
      const { messages, promptType = "standardAssistant", tools = [] } = config;
      const { onText, onMessage, onToolUse, onContentBlock } = callbacks;

      try {
        const systemPrompt = getSystemPrompt(promptType);

        const apiParams = {
          model: "claude-haiku-4-5",
          max_tokens: 4096,
          system: systemPrompt,
          messages: messages,
          stream: true,
        };

        if (tools && tools.length > 0) {
          apiParams.tools = tools;
        }

        console.log("🤖 Calling Claude API...");

        const stream = await client.messages.stream(apiParams);

        let currentMessage = {
          role: "assistant",
          content: [],
          stop_reason: null,
        };

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

        const finalMessage = await stream.finalMessage();

        currentMessage.content = finalMessage.content;
        currentMessage.stop_reason = finalMessage.stop_reason;

        // ✅ CRITICAL FIX: Call onMessage FIRST (adds assistant message to history)
        if (onMessage) {
          await onMessage(currentMessage);
        }

        // ✅ Then handle tool uses (adds tool_result to history)
        const toolUses = finalMessage.content.filter((c) => c.type === "tool_use");
        
        for (const toolUse of toolUses) {
          if (onToolUse) {
            await onToolUse(toolUse);
          }
        }

        return currentMessage;

      } catch (error) {
        console.error("❌ Claude API Error:", error);
        
        if (error.message?.includes("api_key") || error.status === 401) {
          throw new Error("Invalid Anthropic API key. Please check your ANTHROPIC_API_KEY environment variable.");
        }
        
        throw error;
      }
    },
  };
}

function getSystemPrompt(promptType) {
  const prompts = {
    creativeAutomationAssistant: `You are the official AI sales & support assistant for [YOUR COMPANY].

CRITICAL RULES FOR CHECKOUT:
============================================
1. ❌ NEVER manually generate or suggest checkout URLs
2. ✅ ONLY refer to the "Go to Cart" button that appears AFTER user clicks "Add to Cart"
3. When user says "checkout" or "go to cart":
   - Say: "I'll open the cart for you now" 
   - THEN call the openCheckout function (if available)
   - DO NOT suggest any URLs or links
4. ONE checkout URL per session - don't repeat it

PRODUCT VIEWING:
============================================
1. When user clicks "View" button on a product card, it opens the product page
2. Say something like: "I'm opening the product page for you now"
3. DO NOT try to generate product URLs manually

CHECKOUT FLOW:
============================================
- User searches products → shows product cards
- User clicks "Add to Cart" on card → button changes to "Go to Cart"
- User clicks "Go to Cart" → opens Shopify checkout (only once)
- Say: "Here's your checkout page!" 

Never duplicate checkout URLs or create fake product links.`,
    // ... rest of prompts ...
  };

  return prompts[promptType] || prompts.creativeAutomationAssistant;
}
