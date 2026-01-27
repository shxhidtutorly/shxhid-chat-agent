import { generateAuthUrl } from "./auth.server";
import { getCustomerToken } from "./db.server";

/**
 * Client for interacting with Model Context Protocol (MCP) API endpoints.
 * Manages connections to both customer and storefront MCP endpoints, and handles tool invocation.
 */
class MCPClient {
  /**
   * Creates a new MCPClient instance.
   *
   * @param {string} hostUrl - The base URL for the shop
   * @param {string} conversationId - ID for the current conversation
   * @param {string} shopId - ID of the Shopify shop
   */
  constructor(hostUrl, conversationId, shopId, customerMcpEndpoint) {
    this.tools = [];
    this.customerTools = [];
    this.storefrontTools = [];
    
    // FIX: Ensure hostUrl has protocol
    const normalizedHostUrl = hostUrl.startsWith('http') ? hostUrl : `https://${hostUrl}`;
    
    // TODO: Make this dynamic, for that first we need to allow access of mcp tools on password protected demo stores.
    this.storefrontMcpEndpoint = `${normalizedHostUrl}/api/mcp`;

    const accountHostUrl = normalizedHostUrl.replace(/(\.myshopify\.com)$/, '.account$1');
    this.customerMcpEndpoint = customerMcpEndpoint || `${accountHostUrl}/customer/api/mcp`;
    this.customerAccessToken = "";
    this.conversationId = conversationId;
    this.shopId = shopId;
  }

  /**
   * Connects to the customer MCP server and retrieves available tools.
   * Attempts to use an existing token or will proceed without authentication.
   *
   * @returns {Promise<Array>} Array of available customer tools
   * @throws {Error} If connection to MCP server fails
   */
  async connectToCustomerServer() {
    try {
      console.log(`Connecting to MCP server at ${this.customerMcpEndpoint}`);

      if (this.conversationId) {
        const dbToken = await getCustomerToken(this.conversationId);

        if (dbToken && dbToken.accessToken) {
          this.customerAccessToken = dbToken.accessToken;
        } else {
          console.log("No token in database for conversation:", this.conversationId);
        }
      }

      // If we still don't have a token, we'll connect without one
      // and tools that require auth will prompt for it later
      const headers = {
        "Content-Type": "application/json",
        "Authorization": this.customerAccessToken || ""
      };

      const response = await this._makeJsonRpcRequest(
        this.customerMcpEndpoint,
        "tools/list",
        {},
        headers
      );

      // Extract tools from the JSON-RPC response format
      const toolsData = response.result && response.result.tools ? response.result.tools : [];
      const customerTools = this._formatToolsData(toolsData);

      this.customerTools = customerTools;
      this.tools = [...this.tools, ...customerTools];

      return customerTools;
    } catch (e) {
      console.error("Failed to connect to MCP server: ", e);
      throw e;
    }
  }

  /**
   * Connects to the storefront MCP server and retrieves available tools.
   *
   * @returns {Promise<Array>} Array of available storefront tools
   * @throws {Error} If connection to MCP server fails
   */
  async connectToStorefrontServer() {
    try {
      console.log(`Connecting to MCP server at ${this.storefrontMcpEndpoint}`);

      const headers = {
        "Content-Type": "application/json"
      };

      const response = await this._makeJsonRpcRequest(
        this.storefrontMcpEndpoint,
        "tools/list",
        {},
        headers
      );

      // Extract tools from the JSON-RPC response format
      const toolsData = response.result && response.result.tools ? response.result.tools : [];
      const storefrontTools = this._formatToolsData(toolsData);

      this.storefrontTools = storefrontTools;
      this.tools = [...this.tools, ...storefrontTools];

      return storefrontTools;
    } catch (e) {
      console.error("Failed to connect to MCP server: ", e);
      throw e;
    }
  }

  /**
   * Dispatches a tool call to the appropriate MCP server based on the tool name.
   *
   * @param {string} toolName - Name of the tool to call
   * @param {Object} toolArgs - Arguments to pass to the tool
   * @returns {Promise<Object>} Result from the tool call
   * @throws {Error} If tool is not found or call fails
   */
  async callTool(toolName, toolArgs) {
    if (this.customerTools.some(tool => tool.name === toolName)) {
      return this.callCustomerTool(toolName, toolArgs);
    } else if (this.storefrontTools.some(tool => tool.name === toolName)) {
      return this.callStorefrontTool(toolName, toolArgs);
    } else {
      throw new Error(`Tool ${toolName} not found`);
    }
  }

  /**
   * Calls a tool on the storefront MCP server.
   *
   * @param {string} toolName - Name of the storefront tool to call
   * @param {Object} toolArgs - Arguments to pass to the tool
   * @returns {Promise<Object>} Result from the tool call
   * @throws {Error} If the tool call fails
   */
  async callStorefrontTool(toolName, toolArgs) {
    try {
      console.log("Calling storefront tool", toolName, toolArgs);

      const headers = {
        "Content-Type": "application/json"
      };

      const response = await this._makeJsonRpcRequest(
        this.storefrontMcpEndpoint,
        "tools/call",
        {
          name: toolName,
          arguments: toolArgs,
        },
        headers
      );

      return response.result || response;
    } catch (error) {
      console.error(`Error calling tool ${toolName}:`, error);
      throw error;
    }
  }

  /**
   * Calls a tool on the customer MCP server.
   * Handles authentication if needed.
   *
   * @param {string} toolName - Name of the customer tool to call
   * @param {Object} toolArgs - Arguments to pass to the tool
   * @returns {Promise<Object>} Result from the tool call or auth error
   * @throws {Error} If the tool call fails
   */
  async callCustomerTool(toolName, toolArgs) {
    try {
      console.log("Calling customer tool", toolName, toolArgs);
      // First try to get a token from the database for this conversation
      let accessToken = this.customerAccessToken;

      if (!accessToken || accessToken === "") {
        const dbToken = await getCustomerToken(this.conversationId);

        if (dbToken && dbToken.accessToken) {
          accessToken = dbToken.accessToken;
          this.customerAccessToken = accessToken; // Store it for later use
        } else {
          console.log("No token in database for conversation:", this.conversationId);
        }
      }

      const headers = {
        "Content-Type": "application/json",
        "Authorization": accessToken
      };

      try {
        const response = await this._makeJsonRpcRequest(
          this.customerMcpEndpoint,
          "tools/call",
          {
            name: toolName,
            arguments: toolArgs,
          },
          headers
        );

        return response.result || response;
      } catch (error) {
        // Handle 401 specifically to trigger authentication
        if (error.status === 401) {
          console.log("Unauthorized, generating authorization URL for customer");

          // Generate auth URL
          const authResponse = await generateAuthUrl(this.conversationId, this.shopId);

          // Instead of retrying, return the auth URL for the front-end
          return {
            error: {
              type: "auth_required",
              data: `You need to authorize the app to access your customer data. [Click here to authorize](${authResponse.url})`
            }
          };
        }

        // Re-throw other errors
        throw error;
      }
    } catch (error) {
      console.error(`Error calling tool ${toolName}:`, error);
      return {
        error: {
          type: "internal_error",
          data: `Error calling tool ${toolName}: ${error.message}`
        }
      };
    }
  }

  /**
   * Makes a JSON-RPC request to the specified endpoint.
   *
   * @private
   * @param {string} endpoint - The endpoint URL
   * @param {string} method - The JSON-RPC method to call
   * @param {Object} params - Parameters for the method
   * @param {Object} headers - HTTP headers for the request
   * @returns {Promise<Object>} Parsed JSON response
   * @throws {Error} If the request fails
   */
  async _makeJsonRpcRequest(endpoint, method, params, headers) {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: headers,
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: method,
        id: 1,
        params: params
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      const errorObj = new Error(`Request failed: ${response.status} ${error}`);
      errorObj.status = response.status;
      throw errorObj;
    }

    return await response.json();
  }

   /**
   * Convenience wrapper for the storefront `search_shop_catalog` tool.
   * Use this to find products by text (title, SKU, etc.) and get variant IDs.
   *
   * @param {string} query - Search text (e.g. "Abb Inverter Drives ACS480-04-050A-4")
   * @param {string} context - Optional context string for better relevance
   * @returns {Promise<Object>} Raw result from the MCP tool
   */
  async searchShopCatalog(query, context = "customer shopping in chat") {
    const result = await this.callStorefrontTool("search_shop_catalog", {
      query,
      context,
    });

    // The exact shape depends on the MCP tool schema.
    // Typically you'll see something like:
    // {
    //   items: [
    //     {
    //       title,
    //       price,
    //       currency,
    //       variant_id,      // ProductVariant GID
    //       url,
    //       image_url,
    //       description,
    //       ...
    //     }
    //   ]
    // }
    return result;
  }

  /**
   * Convenience wrapper for the storefront `update_cart` tool.
   * Use this to create or update carts.
   *
   * @param {Object} params
   * @param {string|undefined} params.cartId - Existing cart ID (omit to create new cart)
   * @param {Array} params.lines - Array of line updates:
   *   [{ merchandise_id, quantity, line_item_id? }]
   * @returns {Promise<Object>} Cart result from MCP
   */
  async updateCart({ cartId, lines }) {
    const args = {
      // If cartId is undefined, MCP server will create a new cart
      cart_id: cartId,
      lines,
    };

    const result = await this.callStorefrontTool("update_cart", args);
    return result;
  }

  /**
   * High-level helper:
   * - Searches the catalog for the given text
   * - Picks the best matching variant
   * - Adds it to a cart (existing or new)
   *
   * This is the function your "Add ABB Inverter Drives ... to my cart"
   * agent logic should use.
   *
   * @param {Object} params
   * @param {string} params.productQuery - e.g. "Abb Inverter Drives ACS480-04-050A-4"
   * @param {number} params.quantity - Quantity to add
   * @param {string|undefined} params.existingCartId - Existing cart ID, if any
   * @returns {Promise<Object>} The updated/created cart (including checkout URL)
   */
  async addSingleProductToCartFromQuery({
    productQuery,
    quantity = 1,
    existingCartId,
  }) {
    // 1. Search the shop catalog by the product text
    const searchResult = await this.searchShopCatalog(
      productQuery,
      "customer adding product to cart from chat"
    );

    // Adjust this based on the actual schema returned by search_shop_catalog.
    // Most implementations expose an `items` array with a `variant_id` field.
    const items = searchResult?.items || searchResult?.results || [];
    if (!items.length) {
      throw new Error(
        `No products found in catalog for query: "${productQuery}"`
      );
    }

    // For now, just take the first match. You can improve this
    // later by scoring, filtering by vendor, etc.
    const first = items[0];

    // IMPORTANT:
    // `merchandise_id` MUST be a ProductVariant GID, e.g.
    // "gid://shopify/ProductVariant/42567741931576"
    // The Storefront MCP docs say search_shop_catalog returns a "Variant ID".
    //
    // Check your actual search_shop_catalog schema via tools/list,
    // and adjust this field name if needed (e.g. `first.variant_id`).
    const merchandiseId =
      first.merchandise_id ||
      first.variant_id ||
      first.variantId ||
      first.default_variant_id;

    if (!merchandiseId) {
      throw new Error(
        `search_shop_catalog result did not contain a merchandise/variant ID for query: "${productQuery}"`
      );
    }

    // 2. Call update_cart with the correct merchandise_id and quantity
    const cartResult = await this.updateCart({
      cartId: existingCartId,
      lines: [
        {
          merchandise_id: merchandiseId,
          quantity,
        },
      ],
    });

    // cartResult should include the cart object with checkout URL, etc.
    return cartResult;
  }
  
  _formatToolsData(toolsData) {
    return toolsData.map((tool) => {
      return {
        name: tool.name,
        description: tool.description,
        input_schema: tool.inputSchema || tool.input_schema,
      };
    });
  }
}

export default MCPClient;
