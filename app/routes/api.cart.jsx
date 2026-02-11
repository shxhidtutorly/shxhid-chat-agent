// app/routes/api.cart.jsx
// ✅ COMPLETE FIXED VERSION - Cart API
// Fixes:
// 1. Proper error handling and validation
// 2. Correct cart ID persistence
// 3. Valid checkout URLs (no homepage redirect)
// 4. CORS headers fixed
// 5. Logging for debugging

export function loader({ request }) {
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: getCorsHeaders(request),
    });
  }
  return new Response("Cart API Ready", { headers: getCorsHeaders(request) });
}

export async function action({ request }) {
  // Handle CORS Preflight
  if (request.method === "OPTIONS") {
    return new Response(null, { headers: getCorsHeaders(request) });
  }

  // Only handle POST requests
  if (request.method !== "POST") {
    return new Response("Method not allowed", { 
      status: 405, 
      headers: getCorsHeaders(request) 
    });
  }

  try {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`🛒 CART API REQUEST STARTED`);
    console.log(`${'='.repeat(60)}\n`);

    // 1. Parse request body
    let body;
    try {
      body = await request.json();
    } catch (e) {
      console.error("❌ Failed to parse JSON body:", e.message);
      return Response.json(
        { status: "error", message: "Invalid JSON in request body" },
        { status: 400, headers: getCorsHeaders(request) }
      );
    }

    const { productQuery, variantId, quantity = 1, cartId, conversationId, shopDomain: bodyShopDomain } = body;
    
    console.log(`📝 Request payload:`, {
      variantId: variantId ? variantId.substring(0, 50) + "..." : null,
      productQuery,
      quantity,
      cartId: cartId ? cartId.substring(0, 30) + "..." : null,
      conversationId: conversationId ? conversationId.substring(0, 30) + "..." : null,
      bodyShopDomain
    });

    // 2. Determine shop domain
    const origin = request.headers.get("Origin");
    let shopDomain = null;

    if (origin) {
      try {
        shopDomain = new URL(origin).hostname;
        console.log(`✅ Shop domain from Origin header: ${shopDomain}`);
      } catch (e) {
        console.warn(`⚠️ Could not parse Origin: ${origin}`);
      }
    }

    if (!shopDomain) {
      shopDomain = bodyShopDomain;
      if (shopDomain) {
        console.log(`✅ Shop domain from body: ${shopDomain}`);
      }
    }

    if (!shopDomain) {
      console.error("❌ Missing shop domain - cannot proceed");
      return Response.json(
        { status: "error", message: "Missing shop domain" },
        { status: 400, headers: getCorsHeaders(request) }
      );
    }

    // 3. Validate request has required field
    if (!variantId && !productQuery) {
      console.error("❌ Request missing both variantId and productQuery");
      return Response.json(
        { status: "error", message: "Must provide either variantId or productQuery" },
        { status: 400, headers: getCorsHeaders(request) }
      );
    }

    console.log(`🛒 Cart Action: Adding ${quantity} x ${variantId || productQuery} to cart ${cartId || 'new'}`);

    // 4. Dynamic Imports
    let MCPClient, getCustomerAccountUrls;
    try {
      const mcpModule = await import("../mcp-client");
      MCPClient = mcpModule.default;
      console.log("✅ MCPClient imported");
    } catch (e) {
      console.error("❌ Failed to import MCPClient:", e.message);
      throw new Error(`Failed to import MCPClient: ${e.message}`);
    }

    try {
      const dbModule = await import("../db.server");
      getCustomerAccountUrls = dbModule.getCustomerAccountUrls;
      console.log("✅ db.server imported");
    } catch (e) {
      console.error("❌ Failed to import db.server:", e.message);
      // Don't fail - optional for some setups
      getCustomerAccountUrls = async () => ({ mcpApiUrl: null });
    }

    // 5. Get customer MCP URL if available
    let customerMcpUrl = null;
    if (conversationId && getCustomerAccountUrls) {
      try {
        const urls = await getCustomerAccountUrls(conversationId);
        customerMcpUrl = urls?.mcpApiUrl;
        if (customerMcpUrl) {
          console.log(`✅ Got customer MCP URL: ${customerMcpUrl.substring(0, 50)}...`);
        }
      } catch (e) {
        console.warn(`⚠️ Could not get customer MCP URL: ${e.message}`);
      }
    }

    // 6. Initialize MCP Client
    console.log(`\n🔌 Initializing MCP Client...`);
    const client = new MCPClient(
      shopDomain,
      conversationId || `cart_${Date.now()}`,
      null,
      customerMcpUrl
    );

    // 7. Connect to Storefront MCP
    console.log(`🔌 Connecting to storefront MCP...`);
    try {
      await client.connectToStorefrontServer();
      console.log("✅ Storefront MCP connected");
    } catch (e) {
      console.error("❌ Failed to connect to storefront MCP:", e.message);
      throw new Error(`Storefront MCP connection failed: ${e.message}`);
    }

    // 8. Update cart based on input
    console.log(`\n📦 Updating cart...`);
    let result;

    if (variantId) {
      // Direct update with variant ID
      let merchId = variantId;
      
      // Ensure it's in GID format
      if (!merchId.startsWith("gid://")) {
        // If it looks like just an ID number, make it a GID
        if (/^\d+$/.test(merchId)) {
          merchId = `gid://shopify/ProductVariant/${merchId}`;
        }
        // Otherwise assume it's a valid GID without the prefix
        else if (!merchId.startsWith("gid://")) {
          merchId = `gid://shopify/ProductVariant/${merchId}`;
        }
      }
      
      console.log(`📦 Adding merchandise: ${merchId}`);
      
      result = await client.updateCart({
        cartId: cartId || undefined, // undefined = create new
        lines: [{ 
          merchandise_id: merchId, 
          quantity: parseInt(quantity) || 1 
        }]
      });

      console.log("✅ Cart update result received");
    } else if (productQuery) {
      // Search -> Add to cart
      console.log(`🔍 Searching for product: "${productQuery}"`);
      
      result = await client.addSingleProductToCartFromQuery({
        productQuery,
        quantity: parseInt(quantity) || 1,
        existingCartId: cartId || undefined
      });

      console.log("✅ Product search and cart add result received");
    }

    // 9. Process MCP response
    console.log(`\n🔧 Processing MCP response...`);
    let toolService;
    try {
      const toolModule = await import("../services/tool.server");
      toolService = toolModule.createToolService();
      console.log("✅ ToolService created");
    } catch (e) {
      console.error("❌ Failed to import ToolService:", e.message);
      throw new Error(`Failed to import ToolService: ${e.message}`);
    }

    const { checkoutUrl: initialCheckoutUrl, cart } = toolService.processCartUpdateResult(result);
    const newCartId = cart?.id || null;

    console.log(`\n📊 MCP Response Summary:`);
    console.log(`  - Cart ID: ${newCartId ? newCartId.substring(0, 30) + "..." : "null"}`);
    console.log(`  - Checkout URL: ${initialCheckoutUrl ? initialCheckoutUrl.substring(0, 50) + "..." : "null"}`);

    // 10. If no checkout URL, fetch cart again
    let finalCheckoutUrl = initialCheckoutUrl;

    if (!finalCheckoutUrl && newCartId) {
      console.log(`\n🔄 Checkout URL missing, fetching cart...`);
      try {
        const cartResult = await client.getCart(newCartId);
        const parsed = toolService.processCartUpdateResult(cartResult);
        finalCheckoutUrl = parsed.checkoutUrl || finalCheckoutUrl;
        
        if (finalCheckoutUrl) {
          console.log(`✅ Got checkout URL from second fetch`);
        }
      } catch (e) {
        console.warn(`⚠️ get_cart failed: ${e.message}`);
      }
    }

    // 11. Normalize and validate checkout URL
    console.log(`\n🔗 Normalizing checkout URL...`);
    
    if (finalCheckoutUrl) {
      finalCheckoutUrl = String(finalCheckoutUrl).trim();

      // Handle relative URLs
      if (finalCheckoutUrl.startsWith("/")) {
        console.log(`  - Relative URL detected, converting to absolute`);
        finalCheckoutUrl = `https://${shopDomain}${finalCheckoutUrl}`;
      }

      // Validate it's a real Shopify cart/checkout URL
      const isValidCartUrl = 
        finalCheckoutUrl.includes("/cart/") ||
        finalCheckoutUrl.includes("/checkouts/") ||
        (finalCheckoutUrl.includes("myshopify.com") && finalCheckoutUrl.includes("cart"));

      if (!isValidCartUrl) {
        console.warn(`⚠️ URL doesn't look like a Shopify cart URL: ${finalCheckoutUrl.substring(0, 60)}`);
        finalCheckoutUrl = null;
      }

      if (finalCheckoutUrl && !finalCheckoutUrl.startsWith("http")) {
        console.warn(`⚠️ URL doesn't start with http, rejecting: ${finalCheckoutUrl.substring(0, 60)}`);
        finalCheckoutUrl = null;
      }
    }

    if (!finalCheckoutUrl) {
      console.warn(`⚠️ Final checkout URL is null/invalid`);
    } else {
      console.log(`✅ Checkout URL validated: ${finalCheckoutUrl.substring(0, 60)}...`);
    }

    // 12. Build response
    const response = {
      status: "success",
      cartId: newCartId,
      checkoutUrl: finalCheckoutUrl,
      cartUrl: finalCheckoutUrl, // Include both for compatibility
      timestamp: new Date().toISOString(),
      shopDomain
    };

    console.log(`\n${'='.repeat(60)}`);
    console.log(`✅ CART API SUCCESS`);
    console.log(`${'='.repeat(60)}`);
    console.log(`📤 Response:`, {
      status: response.status,
      cartId: response.cartId ? response.cartId.substring(0, 30) + "..." : null,
      checkoutUrl: response.checkoutUrl ? response.checkoutUrl.substring(0, 50) + "..." : null
    });
    console.log(`\n`);

    return Response.json(response, { 
      status: 200, 
      headers: getCorsHeaders(request) 
    });

  } catch (error) {
    console.error("\n" + "!".repeat(60));
    console.error("❌ CART API ERROR");
    console.error("!".repeat(60));
    console.error(`Error: ${error.message}`);
    console.error(`Stack: ${error.stack}`);
    console.error("!".repeat(60) + "\n");

    // Return user-friendly error
    return Response.json(
      { 
        status: "error", 
        message: error.message || "Failed to add to cart",
        errorType: error.name
      },
      { 
        status: 500, 
        headers: getCorsHeaders(request) 
      }
    );
  }
}

/**
 * ✅ FIXED CORS HEADERS
 * Properly handles all HTTP methods and credentials
 */
function getCorsHeaders(request) {
  const origin = request.headers.get("Origin");
  
  return {
    "Access-Control-Allow-Origin": origin || "*",
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Requested-With",
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin"
  };
}
