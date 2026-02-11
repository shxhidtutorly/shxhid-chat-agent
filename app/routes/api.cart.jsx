// app/routes/api.cart.jsx
// FIXED VERSION - Cart API with proper validation & debugging

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

  try {
    // 1. Dynamic Imports
    const { default: MCPClient } = await import("../mcp-client");
    const { getCustomerAccountUrls } = await import("../db.server");

    const body = await request.json();
    const { productQuery, variantId, quantity = 1, cartId, conversationId } = body;
    
    // Determine shop domain
    const origin = request.headers.get("Origin");
    const shopDomain = origin ? new URL(origin).hostname : (body.shopDomain || null);
    
    if (!shopDomain) {
      return Response.json(
        { error: "Missing shop domain" },
        { status: 400, headers: getCorsHeaders(request) }
      );
    }

    console.log(`🛒 Cart Action: Adding ${quantity} x ${variantId || productQuery} to cart ${cartId || 'new'}`);

    // Initialize MCP Client
    const urls = await getCustomerAccountUrls(conversationId || "cart_action");
    const client = new MCPClient(shopDomain, conversationId || "cart_action", null, urls?.mcpApiUrl);
    
    // Connect to Storefront MCP
    await client.connectToStorefrontServer();

    let result;

    if (variantId) {
      // Direct update with variant ID (expects GID format)
      const merchId = String(variantId).startsWith("gid://")
        ? variantId
        : `gid://shopify/ProductVariant/${variantId}`;
      
      console.log(`📦 Adding merchandise: ${merchId}`);
      
      result = await client.updateCart({
        cartId: cartId,
        lines: [{ merchandise_id: merchId, quantity: parseInt(quantity) }]
      });
    } else if (productQuery) {
      // Helper method: Search -> Variant -> Update Cart
      result = await client.addSingleProductToCartFromQuery({
        productQuery,
        quantity: parseInt(quantity),
        existingCartId: cartId
      });
    } else {
      throw new Error("Must provide variantId or productQuery");
    }

    // Process result from MCP
    const { createToolService } = await import("../services/tool.server");
    const toolService = createToolService();
    let { checkoutUrl, cart } = toolService.processCartUpdateResult(result);

    const newCartId = cart?.id || null;

    // If checkoutUrl missing, fetch cart again
    if (!checkoutUrl && newCartId) {
      try {
        const cartResult = await client.getCart(newCartId);
        const parsed = toolService.processCartUpdateResult(cartResult);
        checkoutUrl = parsed.checkoutUrl || checkoutUrl;
        cart = parsed.cart || cart;
      } catch (e) {
        console.warn("🛒 get_cart failed:", e?.message || e);
      }
    }

    // Normalize checkoutUrl to absolute URL
    let finalCheckoutUrl = checkoutUrl;
    if (typeof finalCheckoutUrl === "string") {
      finalCheckoutUrl = finalCheckoutUrl.trim();
      
      // CRITICAL FIX: Handle relative URLs properly
      if (finalCheckoutUrl && finalCheckoutUrl.startsWith("/")) {
        finalCheckoutUrl = `https://${shopDomain}${finalCheckoutUrl}`;
      }
      
      // Validate it's a real cart/checkout URL
      if (finalCheckoutUrl && 
          (finalCheckoutUrl.includes("/cart") || finalCheckoutUrl.includes("/checkouts"))) {
        // Keep it
      } else {
        finalCheckoutUrl = null;
      }
    } else {
      finalCheckoutUrl = null;
    }

    console.log(`✅ Cart response - ID: ${newCartId}, Checkout URL: ${finalCheckoutUrl}`);

    return Response.json({
      status: "success",
      cartId: newCartId,
      checkoutUrl: finalCheckoutUrl,
      cartUrl: finalCheckoutUrl, // Include both names for compatibility
      raw: cart
    }, { headers: getCorsHeaders(request) });

  } catch (error) {
    console.error("❌ Cart API Error:", error);
    return Response.json({ 
      status: "error", 
      message: error.message || "Failed to add to cart" 
    }, { status: 500, headers: getCorsHeaders(request) });
  }
}

function getCorsHeaders(request) {
  const origin = request.headers.get("Origin");
  return {
    "Access-Control-Allow-Origin": origin || "*",
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400",
  };
}
