/**
 * Claude Service
 * app/services/claude.server.js
 *
 * Manages interactions with the Claude / Anthropic API
 * Hardened for production use with Shopify Storefront MCP
 */

import { Anthropic } from "@anthropic-ai/sdk";
import AppConfig from "./config.server";
import systemPrompts from "../prompts/prompts.json";

/**
 * Creates a Claude service instance
 * @param {string} apiKey - Claude / Anthropic API key
 */
export function createClaudeService(
  apiKey = process.env.CLAUDE_API_KEY || process.env.ANTHROPIC_API_KEY
) {
  if (!apiKey) {
    throw new Error(
      "Missing API key: set CLAUDE_API_KEY or ANTHROPIC_API_KEY in environment variables."
    );
  }

  /**
   * Anthropic client
   * Use direct API unless Shopify proxy is explicitly required
   */
  const anthropic = new Anthropic({
    apiKey,
    baseUrl: process.env.ANTHROPIC_BASE_URL || "https://api.anthropic.com"
  });

  /**
   * Safely resolve system prompt
   */
  const getSystemPrompt = (promptType) => {
    // Support both shapes:
    // { systemPrompts: {...} } OR { ... }
    const promptsRoot =
      systemPrompts && systemPrompts.systemPrompts
        ? systemPrompts.systemPrompts
        : systemPrompts || {};

    const defaultKey = AppConfig?.api?.defaultPromptType;
    const requestedKey = promptType || defaultKey;

    const isValid = (p) =>
      p && typeof p.content === "string" && p.content.trim().length > 0;

    // 1. Requested prompt
    if (requestedKey && isValid(promptsRoot[requestedKey])) {
      return promptsRoot[requestedKey].content;
    }

    // 2. Default prompt
    if (defaultKey && isValid(promptsRoot[defaultKey])) {
      console.warn(
        `[Claude] Prompt "${requestedKey}" not found. Falling back to default "${defaultKey}".`
      );
      return promptsRoot[defaultKey].content;
    }

    // 3. First valid prompt
    const firstValidKey = Object.keys(promptsRoot).find((k) =>
      isValid(promptsRoot[k])
    );

    if (firstValidKey) {
      console.warn(
        `[Claude] Prompt "${requestedKey}" not found. Falling back to "${firstValidKey}".`
      );
      return promptsRoot[firstValidKey].content;
    }

    // 4. Hard fallback (never crashes)
    console.error(
      "[Claude] No valid system prompts found. Using emergency fallback."
    );

    return `
You are a professional B2B e-commerce assistant for an industrial automation store.
Answer clearly, accurately, and concisely.
Help users find products, SKUs, compatibility, pricing, availability, and checkout steps.
If a question is unclear, ask one clarifying question before proceeding.
`;
  };

  /**
   * Streams a conversation with Claude
   */
  const streamConversation = async (
    { messages, promptType = AppConfig.api.defaultPromptType, tools },
    streamHandlers = {}
  ) => {
    const systemInstruction = getSystemPrompt(promptType);

    let stream;
    try {
      stream = await anthropic.messages.stream({
        model: AppConfig.api.defaultModel,
        max_tokens: AppConfig.api.maxTokens,
        system: systemInstruction,
        messages,
        tools: tools && tools.length > 0 ? tools : undefined
      });
    } catch (err) {
      console.error("[Claude] Failed to start stream:", err);
      throw err;
    }

    if (streamHandlers.onText) {
      stream.on("text", streamHandlers.onText);
    }

    if (streamHandlers.onMessage) {
      stream.on("message", streamHandlers.onMessage);
    }

    if (streamHandlers.onContentBlock) {
      stream.on("contentBlock", streamHandlers.onContentBlock);
    }

    const finalMessage = await stream.finalMessage();

    if (
      streamHandlers.onToolUse &&
      finalMessage &&
      Array.isArray(finalMessage.content)
    ) {
      for (const block of finalMessage.content) {
        if (block.type === "tool_use") {
          await streamHandlers.onToolUse(block);
        }
      }
    }

    return finalMessage;
  };

  return {
    streamConversation,
    getSystemPrompt
  };
}

export default {
  createClaudeService
};
