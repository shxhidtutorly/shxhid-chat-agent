import { generateAuthUrl } from "./auth.server";
import { getCustomerToken } from "./db.server";

/**
 * MCPClient - Optimized & Robust Version
 * Client for interacting with Model Context Protocol (MCP) API endpoints
 * Handles customer and storefront MCP connections with comprehensive error handling
 */
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

  /**
   * Normalize URL to ensure protocol
   * @private
   */
  _normalizeUrl(url) {
    if (!url) throw new Error("hostUrl is required");
    
    // Already has protocol
    if (url.startsWith('http://') || url.startsWith('https://')) {
      return url;
    }
    
    // Add https by default
    return `https://${url}`;
  }

  /**
   * Connect to customer MCP server with token management
   * Gracefully handles missing tokens
   *
   * @returns {Promise<Array>} Array of available customer tools
   */
  async connectToCustomerServer() {
    try {
      console.log(`🔌 Connecting to customer MCP: ${this.customerMcpEndpoint}`);

      // Try to get existing token
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

      const headers = {
        "Content-Type": "application/json",
      };

      // Add auth header if we have a token
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
      
      // Don't throw - allow operation to continue without customer tools
      return [];
    }
  }

  /**
   * Connect to storefront MCP server
   * This is the primary connection for product/cart operations
   *
   * @returns {Promise<Array>} Array of available storefront tools
   */
  async connectToStorefrontServer() {
    try {
      console.log(`🔌 Connecting to storefront MCP: ${this.storefrontMcpEndpoint}`);

      const headers = {
        "Content-Type": "application/json",
      };

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

  /**
   * Dispatch tool call to appropriate MCP server
   *
   * @param {string} toolName - Name of the tool to call
   * @param {Object} toolArgs - Arguments to pass to the tool
   * @returns {Promise<Object>} Result from the tool call
   */
  async callTool(toolName, toolArgs) {
    // Determine which server to use
    if (this.customerTools.some(tool => tool.name === toolName)) {
      return this.callCustomerTool(toolName, toolArgs);
    } else if (this.storefrontTools.some(tool => tool.name === toolName)) {
      return this.callStorefrontTool(toolName, toolArgs);
    } else {
      throw new Error(`Tool '${toolName}' not found in any connected MCP server`);
    }
  }

  /**
   * Call storefront tool with retry logic
   *
   * @param {string} toolName - Name of the storefront tool
   * @param {Object} toolArgs - Arguments for the tool
   * @returns {Promise<Object>} Tool result
   */
  async callStorefrontTool(toolName, toolArgs) {
    console.log(`📞 Calling storefront tool: ${toolName}`);

    const headers = {
      "Content-Type": "application/json",
    };

    try {
      const response = await this._makeJsonRpcRequestWithRetry(
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
      console.error(`❌ Storefront tool '${toolName}' failed:`, error.message);
      throw error;
    }
  }

  /**
   * Call customer tool with authentication handling
   *
   * @param {string} toolName - Name of the customer tool
   * @param {Object} toolArgs - Arguments for the tool
   * @returns {Promise<Object>} Tool result or auth error
   */
  async callCustomerTool(toolName, toolArgs) {
    console.log(`📞 Calling customer tool: ${toolName}`);

    // Get or refresh token
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

    const headers = {
      "Content-Type": "application/json",
    };

    if (accessToken) {
      headers["Authorization"] = accessToken;
    }

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
      // Handle 401 authentication errors
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
            error: {
              type: "auth_failed",
              message: "Could not generate authorization URL",
            },
          };
        }
      }

      // Other errors
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
   * Search shop catalog by natural language query
   * No need for SKU or variant ID
   *
   * @param {string} query - Search text (e.g. "ABB inverter drives")
   * @param {string} context - Optional context for better results
   * @returns {Promise<Object>} Search results with products
   */
  async searchShopCatalog(query, context = "customer shopping in chat") {
    if (!query || typeof query !== "string") {
      throw new Error("Search query is required");
    }

    console.log(`🔍 Searching catalog for: "${query}"`);

    try {
      const result = await this.callStorefrontTool("search_shop_catalog", {
        query: query.trim(),
        context,
      });

      // Validate result structure
      if (!result || typeof result !== "object") {
        throw new Error("Invalid search result structure");
      }

      return result;

    } catch (error) {
      console.error("❌ Catalog search failed:", error.message);
      throw new Error(`Product search failed: ${error.message}`);
    }
  }

  /**
   * Update cart with products
   * Creates new cart if cartId is not provided
   *
   * @param {Object} params
   * @param {string} [params.cartId] - Existing cart ID (optional)
   * @param {Array} params.lines - Cart line items
   * @returns {Promise<Object>} Updated cart with checkout URL
   */
  async updateCart({ cartId, lines }) {
    if (!lines || !Array.isArray(lines) || lines.length === 0) {
      throw new Error("Cart lines are required");
    }

    console.log(`🛒 Updating cart ${cartId || '(new)'} with ${lines.length} item(s)`);

    // Validate line items
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
        cart_id: cartId || undefined, // undefined will create new cart
        lines: validLines,
      });

      console.log("✅ Cart updated successfully");
      return result;

    } catch (error) {
      console.error("❌ Cart update failed:", error.message);
      throw new Error(`Failed to update cart: ${error.message}`);
    }
  }

  /**
   * High-level helper: Search and add product to cart
   * Combines search + cart update in one operation
   *
   * @param {Object} params
   * @param {string} params.productQuery - Product search query
   * @param {number} [params.quantity=1] - Quantity to add
   * @param {string} [params.existingCartId] - Existing cart ID
   * @returns {Promise<Object>} Updated cart
   */
  async addSingleProductToCartFromQuery({
    productQuery,
    quantity = 1,
    existingCartId,
  }) {
    if (!productQuery) {
      throw new Error("Product query is required");
    }

    console.log(`🛍️ Adding "${productQuery}" to cart (qty: ${quantity})`);

    try {
      // 1. Search for the product
      const searchResult = await this.searchShopCatalog(
        productQuery,
        "customer adding product to cart from chat"
      );

      // 2. Extract products from result
      const items = searchResult?.items || searchResult?.results || searchResult?.products || [];
      
      if (!items || items.length === 0) {
        throw new Error(`No products found for "${productQuery}"`);
      }

      console.log(`✅ Found ${items.length} matching product(s)`);

      // 3. Get first product's variant ID
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

      // 4. Add to cart
      const cartResult = await this.updateCart({
        cartId: existingCartId,
        lines: [
          {
            merchandise_id: merchandiseId,
            quantity: parseInt(quantity) || 1,
          },
        ],
      });

      console.log("✅ Product added to cart successfully");
      return cartResult;

    } catch (error) {
      console.error("❌ Failed to add product to cart:", error.message);
      throw error;
    }
  }

  /**
   * Get cart by ID
   *
   * @param {string} cartId - Cart ID to retrieve
   * @returns {Promise<Object>} Cart data
   */
  async getCart(cartId) {
    if (!cartId) {
      throw new Error("Cart ID is required");
    }

    try {
      const result = await this.callStorefrontTool("get_cart", {
        cart_id: cartId,
      });

      return result;
    } catch (error) {
      console.error("❌ Failed to get cart:", error.message);
      throw error;
    }
  }

  /**
   * Make JSON-RPC request with error handling
   * @private
   */
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

      // Check for JSON-RPC error
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

  /**
   * Make JSON-RPC request with retry logic
   * @private
   */
  async _makeJsonRpcRequestWithRetry(endpoint, method, params, headers, attempt = 1) {
    try {
      return await this._makeJsonRpcRequest(endpoint, method, params, headers);
    } catch (error) {
      // Don't retry auth errors or client errors
      if (error.status === 401 || error.status === 400) {
        throw error;
      }

      // Retry on network/server errors
      if (attempt < this.retryAttempts) {
        console.log(`⚠️ Retry attempt ${attempt}/${this.retryAttempts} for ${method}`);
        
        await new Promise(resolve => setTimeout(resolve, this.retryDelay * attempt));
        
        return this._makeJsonRpcRequestWithRetry(
          endpoint,
          method,
          params,
          headers,
          attempt + 1
        );
      }

      throw error;
    }
  }

  /**
   * Format tools data from MCP response
   * @private
   */
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

  /**
   * Get all available tools
   */
  getAllTools() {
    return {
      all: this.tools,
      customer: this.customerTools,
      storefront: this.storefrontTools,
    };
  }

  /**
   * Check if a specific tool is available
   */
  hasToolAvailable(toolName) {
    return this.tools.some(tool => tool.name === toolName);
  }

  /**
   * Get tool schema
   */
  getToolSchema(toolName) {
    const tool = this.tools.find(t => t.name === toolName);
    return tool?.input_schema || null;
  }
}

export default MCPClient;
