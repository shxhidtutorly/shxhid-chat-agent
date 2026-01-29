// app/routes/api.cart.jsx
import { json } from "@remix-run/node";
import MCPClient from "../mcp-client";
import { getCustomerAccountUrls } from "../db.server";

// Handle CORS
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
  if (request.method === "OPTIONS") {
    return new Response(null, { headers: getCorsHeaders(request) });
  }

  try {
    const body = await request.json();
    const { productQuery, variantId, quantity = 1, cartId, conversationId } = body;
    
    // Determine shop domain
    const origin = request.headers.get("Origin");
    const shopDomain = origin ? new URL(origin).hostname : (body.shopDomain || null);
    
    if (!shopDomain) {
      return json({ error: "Missing shop domain" }, { status: 400, headers: getCorsHeaders(request) });
    }

    console.log(`🛒 Cart Action: Adding ${quantity} x ${variantId || productQuery} to cart ${cartId || 'new'}`);

    // Initialize MCP Client
    // We need the MCP endpoint URL
    const dbMod = await import("../db.server");
    const urls = await dbMod.getCustomerAccountUrls(shopDomain, conversationId || "default");
    const mcpApiUrl = urls?.mcpApiUrl;

    const client = new MCPClient(shopDomain, conversationId || "cart_action", null, mcpApiUrl);
    
    // Connect to Storefront MCP
    await client.connectToStorefrontServer();

    let result;

    if (variantId) {
      // Direct update if we have the variant ID
      result = await client.updateCart({
        cartId: cartId,
        lines: [{ merchandise_id: variantId, quantity: parseInt(quantity) }]
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

    // Extract checkout URL and Cart ID
    const cart = result.cart || result;
    const checkoutUrl = cart.checkoutUrl || cart.checkout_url;
    const newCartId = cart.id;

    return json({
      status: "success",
      cartId: newCartId,
      checkoutUrl: checkoutUrl,
      raw: cart
    }, { headers: getCorsHeaders(request) });

  } catch (error) {
    console.error("Cart API Error:", error);
    return json({ 
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
