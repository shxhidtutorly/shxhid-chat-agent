import { generateAuthUrl } from "./auth.server";
import { getCustomerToken } from "./db.server";

/**
 * MCPClient — v2.1
 * Client for interacting with Model Context Protocol (MCP) API endpoints
 * Handles customer and storefront MCP connections with comprehensive error handling
 *
 * CHANGES (v2.1 — April 2026):
 *   - `searchShopCatalog()` now looks up the active catalog-search tool name
 *     from advertised tools instead of hardcoding "search_shop_catalog".
 *     Shopify's Storefront MCP renamed the tool to `search_catalog`, which
 *     made the hardcoded call fail with "Tool not found" for any path that
 *     used this helper.
 *   - `searchShopCatalog()` no longer sends the `context` argument — not all
 *     versions of the tool accept it, and sending unknown params triggers
 *     "Invalid params" responses.
 */

// Names Shopify's Storefront MCP has used for catalog search across versions.
const CATALOG_SEARCH_TOOL_NAMES = new Set([
  "search_shop_catalog",  // legacy
  "search_catalog",       // current (confirmed April 2026)
  "search_products",      // defensive — observed in some rollouts
]);

function isCatalogSearchTool(toolName) {
  return CATALOG_SEARCH_TOOL_NAMES.has(String(toolName || "").toLowerCase());
}

class MCPClient {
  /**
   * Creates a new MCPClient instance
   *
   * @param {string} hostUrl - The base URL for the shop
   * @param {string} conversationId - ID for the current conversation
   * @param {string} shopId - ID of the Shopify shop
   * @param {string} customerMcpEndpoint - Optional custom MCP endpoint
   */
  constructor(hostUrl, conversationId, shopId, customerMcpEndpoint) {
    this.tools = [];
    this.customerTools = [];
    this.storefrontTools = [];

    // Normalize hostUrl to ensure it has protocol
    this.hostUrl = this._normalizeUrl(hostUrl);

    // Configure MCP endpoints
    this.storefrontMcpEndpoint = `${this.hostUrl}/api/mcp`;

    const accountHostUrl = this.hostUrl.replace(/(\.myshopify\.com)$/, '.account$1');
    this.customerMcpEndpoint = customerMcpEndpoint || `${accountHostUrl}/customer/api/mcp`;

    this.customerAccessToken = "";
    this.conversationId = conversationId;
    this.shopId = shopId;

    // Configuration
    this.retryAttempts = 3;
    this.retryDelay = 1000; // ms
  }

  _normalizeUrl(url) {
    const resolved = url || process.env.SHOPIFY_STORE_DOMAIN;
    if (!resolved) {
      throw new Error(
        "hostUrl is required: pass shopDomain or set SHOPIFY_STORE_DOMAIN env var"
      );
    }
    if (resolved.startsWith('http://') || resolved.startsWith('https://')) {
      return resolved;
    }
    return `https://${resolved}`;
  }

  /**
   * v2.1: Find the catalog-search tool name the MCP is currently advertising.
   * Falls back to "search_catalog" (the current Shopify default) if nothing
   * matches — which is better than the legacy "search_shop_catalog".
   */
  getCatalogSearchToolName() {
    const found = (this.storefrontTools || []).find(t => isCatalogSearchTool(t.name));
    return found?.name || "search_catalog";
  }

  async connectToCustomerServer() {
    try {
      console.log(`🔌 Connecting to customer MCP: ${this.customerMcpEndpoint}`);

      if (this.conversationId) {
        try {
          const dbToken = await getCustomerToken(this.conversationId);
          if (dbToken?.accessToken) {
            this.customerAccessToken = dbToken.accessToken;
            console.log("✅ Using existing customer token");
          }
        } catch (tokenError) {
          console.warn("⚠️ Could not retrieve customer token:", tokenError.message);
        }
      }

      const headers = { "Content-Type": "application/json" };
      if (this.customerAccessToken) {
        headers["Authorization"] = this.customerAccessToken;
      }

      const response = await this._makeJsonRpcRequest(
        this.customerMcpEndpoint,
        "tools/list",
        {},
        headers
      );

      const toolsData = response.result?.tools || [];
      const customerTools = this._formatToolsData(toolsData);

      this.customerTools = customerTools;
      this.tools = [...this.tools, ...customerTools];

      console.log(`✅ Connected to customer MCP: ${customerTools.length} tools available`);
      return customerTools;

    } catch (error) {
      console.error("❌ Failed to connect to customer MCP:", error.message);
      return [];
    }
  }

  async connectToStorefrontServer() {
    try {
      console.log(`🔌 Connecting to storefront MCP: ${this.storefrontMcpEndpoint}`);

      const headers = { "Content-Type": "application/json" };

      const response = await this._makeJsonRpcRequest(
        this.storefrontMcpEndpoint,
        "tools/list",
        {},
        headers
      );

      const toolsData = response.result?.tools || [];
      const storefrontTools = this._formatToolsData(toolsData);

      this.storefrontTools = storefrontTools;
      this.tools = [...this.tools, ...storefrontTools];

      console.log(`✅ Connected to storefront MCP: ${storefrontTools.length} tools available`);
      return storefrontTools;

    } catch (error) {
      console.error("❌ Failed to connect to storefront MCP:", error.message);
      throw new Error(`Storefront MCP connection failed: ${error.message}`);
    }
  }

  async callTool(toolName, toolArgs) {
    if (this.customerTools.some(tool => tool.name === toolName)) {
      return this.callCustomerTool(toolName, toolArgs);
    } else if (this.storefrontTools.some(tool => tool.name === toolName)) {
      return this.callStorefrontTool(toolName, toolArgs);
    } else {
      throw new Error(`Tool '${toolName}' not found in any connected MCP server`);
    }
  }

  async callStorefrontTool(toolName, toolArgs) {
    console.log(`📞 Calling storefront tool: ${toolName}`);

    const headers = { "Content-Type": "application/json" };

    try {
      const response = await this._makeJsonRpcRequestWithRetry(
        this.storefrontMcpEndpoint,
        "tools/call",
        { name: toolName, arguments: toolArgs },
        headers
      );
      return response.result || response;
    } catch (error) {
      console.error(`❌ Storefront tool '${toolName}' failed:`, error.message);
      throw error;
    }
  }

  async callCustomerTool(toolName, toolArgs) {
    console.log(`📞 Calling customer tool: ${toolName}`);

    let accessToken = this.customerAccessToken;

    if (!accessToken) {
      try {
        const dbToken = await getCustomerToken(this.conversationId);
        if (dbToken?.accessToken) {
          accessToken = dbToken.accessToken;
          this.customerAccessToken = accessToken;
        }
      } catch (error) {
        console.warn("⚠️ Could not retrieve token:", error.message);
      }
    }

    const headers = { "Content-Type": "application/json" };
    if (accessToken) headers["Authorization"] = accessToken;

    try {
      const response = await this._makeJsonRpcRequest(
        this.customerMcpEndpoint,
        "tools/call",
        { name: toolName, arguments: toolArgs },
        headers
      );
      return response.result || response;
    } catch (error) {
      if (error.status === 401) {
        console.log("🔐 Authentication required, generating auth URL");
        try {
          const authResponse = await generateAuthUrl(this.conversationId, this.shopId);
          return {
            error: {
              type: "auth_required",
              message: "Authentication required",
              auth_url: authResponse.url,
              data: `You need to authorize the app. [Click here to authorize](${authResponse.url})`,
            },
          };
        } catch (authError) {
          console.error("❌ Failed to generate auth URL:", authError.message);
          return {
            error: { type: "auth_failed", message: "Could not generate authorization URL" },
          };
        }
      }

      console.error(`❌ Customer tool '${toolName}' failed:`, error.message);
      return {
        error: {
          type: "tool_error",
          message: `Error calling tool ${toolName}: ${error.message}`,
        },
      };
    }
  }

  /**
   * Search shop catalog by natural language query.
   *
   * v2.1: No longer hardcodes "search_shop_catalog". Uses whichever
   * catalog-search tool the MCP advertises (search_catalog on current
   * Shopify Storefront MCP). Does not send `context` — some versions
   * of the new tool reject unknown parameters with "Invalid params".
   */
  async searchShopCatalog(query, /* context no longer used */ _context) {
    if (!query || typeof query !== "string") {
      throw new Error("Search query is required");
    }

    const toolName = this.getCatalogSearchToolName();
    console.log(`🔍 Searching catalog for: "${query}" via tool "${toolName}"`);

    try {
      const result = await this.callStorefrontTool(toolName, {
        query: query.trim(),
      });

      if (!result || typeof result !== "object") {
        throw new Error("Invalid search result structure");
      }
      return result;
    } catch (error) {
      console.error("❌ Catalog search failed:", error.message);
      throw new Error(`Product search failed: ${error.message}`);
    }
  }

  async updateCart({ cartId, lines }) {
    if (!lines || !Array.isArray(lines) || lines.length === 0) {
      throw new Error("Cart lines are required");
    }

    console.log(`🛒 Updating cart ${cartId || '(new)'} with ${lines.length} item(s)`);

    const validLines = lines.filter(line => {
      if (!line.merchandise_id) {
        console.warn("⚠️ Line item missing merchandise_id:", line);
        return false;
      }
      return true;
    });

    if (validLines.length === 0) {
      throw new Error("No valid line items to add to cart");
    }

    try {
      const result = await this.callStorefrontTool("update_cart", {
        cart_id: cartId || undefined,
        lines: validLines,
      });
      console.log("✅ Cart updated successfully");
      return result;
    } catch (error) {
      console.error("❌ Cart update failed:", error.message);
      throw new Error(`Failed to update cart: ${error.message}`);
    }
  }

  async addSingleProductToCartFromQuery({ productQuery, quantity = 1, existingCartId }) {
    if (!productQuery) {
      throw new Error("Product query is required");
    }

    console.log(`🛍️ Adding "${productQuery}" to cart (qty: ${quantity})`);

    try {
      const searchResult = await this.searchShopCatalog(productQuery);

      const items = searchResult?.items || searchResult?.results || searchResult?.products || [];
      if (!items || items.length === 0) {
        throw new Error(`No products found for "${productQuery}"`);
      }

      console.log(`✅ Found ${items.length} matching product(s)`);

      const firstProduct = items[0];
      const merchandiseId =
        firstProduct.merchandise_id ||
        firstProduct.variant_id ||
        firstProduct.variantId ||
        firstProduct.default_variant_id ||
        firstProduct.id;

      if (!merchandiseId) {
        console.error("❌ Product missing variant ID:", firstProduct);
        throw new Error("Product does not have a valid variant ID");
      }

      console.log(`✅ Using variant ID: ${merchandiseId}`);

      const cartResult = await this.updateCart({
        cartId: existingCartId,
        lines: [{ merchandise_id: merchandiseId, quantity: parseInt(quantity) || 1 }],
      });

      console.log("✅ Product added to cart successfully");
      return cartResult;
    } catch (error) {
      console.error("❌ Failed to add product to cart:", error.message);
      throw error;
    }
  }

  async getCart(cartId) {
    if (!cartId) {
      throw new Error("Cart ID is required");
    }
    try {
      const result = await this.callStorefrontTool("get_cart", { cart_id: cartId });
      return result;
    } catch (error) {
      console.error("❌ Failed to get cart:", error.message);
      throw error;
    }
  }

  async _makeJsonRpcRequest(endpoint, method, params, headers) {
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: headers,
        body: JSON.stringify({
          jsonrpc: "2.0",
          method: method,
          id: Date.now(),
          params: params,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        const error = new Error(`Request failed: ${response.status} ${errorText}`);
        error.status = response.status;
        throw error;
      }

      const data = await response.json();

      if (data.error) {
        const error = new Error(data.error.message || "JSON-RPC error");
        error.code = data.error.code;
        throw error;
      }

      return data;
    } catch (error) {
      console.error(`❌ JSON-RPC request failed (${method}):`, error.message);
      throw error;
    }
  }

  async _makeJsonRpcRequestWithRetry(endpoint, method, params, headers, attempt = 1) {
    try {
      return await this._makeJsonRpcRequest(endpoint, method, params, headers);
    } catch (error) {
      if (error.status === 401 || error.status === 400) {
        throw error;
      }
      if (attempt < this.retryAttempts) {
        console.log(`⚠️ Retry attempt ${attempt}/${this.retryAttempts} for ${method}`);
        await new Promise(resolve => setTimeout(resolve, this.retryDelay * attempt));
        return this._makeJsonRpcRequestWithRetry(endpoint, method, params, headers, attempt + 1);
      }
      throw error;
    }
  }

  _formatToolsData(toolsData) {
    if (!Array.isArray(toolsData)) {
      console.warn("⚠️ Invalid tools data format");
      return [];
    }
    return toolsData.map((tool) => ({
      name: tool.name,
      description: tool.description || "",
      input_schema: tool.inputSchema || tool.input_schema || {},
    }));
  }

  getAllTools() {
    return {
      all: this.tools,
      customer: this.customerTools,
      storefront: this.storefrontTools,
    };
  }

  hasToolAvailable(toolName) {
    return this.tools.some(tool => tool.name === toolName);
  }

  getToolSchema(toolName) {
    const tool = this.tools.find(t => t.name === toolName);
    return tool?.input_schema || null;
  }
}

export default MCPClient;
