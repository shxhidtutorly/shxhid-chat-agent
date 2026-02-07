// app/routes/api.cart.jsx
// FIXED: Removed invalid @remix-run/node import
// FIXED: Uses Response.json() for React Router v7 compatibility

// Handle CORS Preflight
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
    // 1. Dynamic Imports to prevent "Server-only module" build errors
    const { default: MCPClient } = await import("../mcp-client");
    const { getCustomerAccountUrls } = await import("../db.server");

    const body = await request.json();
    const { productQuery, variantId, quantity = 1, cartId, conversationId } = body;
    
    // Determine shop domain
    const origin = request.headers.get("Origin");
    const shopDomain = origin ? new URL(origin).hostname : (body.shopDomain || null);
    
    if (!shopDomain) {
      // Use Response.json instead of json() helper
      return Response.json({ error: "Missing shop domain" }, { status: 400, headers: getCorsHeaders(request) });
    }

    console.log(`🛒 Cart Action: Adding ${quantity} x ${variantId || productQuery} to cart ${cartId || 'new'}`);

    // Initialize MCP Client (storefront MCP at shopDomain/api/mcp; customer MCP override from DB if any)
    const urls = await getCustomerAccountUrls(conversationId || "cart_action");
    const client = new MCPClient(shopDomain, conversationId || "cart_action", null, urls?.mcpApiUrl);
    
    // Connect to Storefront MCP
    await client.connectToStorefrontServer();

    let result;

    if (variantId) {
      // Direct update if we have the variant ID (Storefront MCP expects merchandise_id as GID)
      const merchId = String(variantId).startsWith("gid://")
        ? variantId
        : `gid://shopify/ProductVariant/${variantId}`;
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

    // MCP update_cart returns { content: [{ type: "text", text: "{\"cart\": {...}}" }] }
    // Use the same parsing logic as chat route's processCartUpdateResult
    const { createToolService } = await import("../services/tool.server");
    const toolService = createToolService();
    const { checkoutUrl, cart } = toolService.processCartUpdateResult(result);

    const newCartId = cart?.id || null;

    let finalCheckoutUrl = checkoutUrl;
    if (!finalCheckoutUrl && variantId) {
      // Fallback: Shopify cart permalink adds item and redirects to checkout
      const numericId = String(variantId).replace(/^gid:\/\/shopify\/ProductVariant\//, "").trim();
      if (numericId && /^\d+$/.test(numericId)) {
        finalCheckoutUrl = `https://${shopDomain}/cart/${numericId}:${parseInt(quantity)}`;
        console.log("🛒 Using fallback cart permalink:", finalCheckoutUrl);
      }
    }
    if (!finalCheckoutUrl) {
      console.warn("🛒 Cart updated but no checkoutUrl; MCP structure:", JSON.stringify(result).slice(0, 500));
    }

    return Response.json({
      status: "success",
      cartId: newCartId,
      checkoutUrl: finalCheckoutUrl || null,
      raw: cart
    }, { headers: getCorsHeaders(request) });

  } catch (error) {
    console.error("Cart API Error:", error);
    return Response.json({ 
      status: "error", 
      message: error.message || "Failed to add to cart" 
    }, { status: 500, headers: getCorsHeaders(request) });
  }
}

function getCorsHeaders(request) {
  const origin = request.headers.get("Origin") || "*";
  return {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Accept",
    "Access-Control-Allow-Credentials": "true",
  };
}
