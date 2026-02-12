// app/routes/api.cart.jsx
// ✅ FINAL COMPLETE FIX - All issues resolved

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

  if (request.method !== "POST") {
    return new Response("Method not allowed", { 
      status: 405, 
      headers: getCorsHeaders(request) 
    });
  }

  try {
    // Parse request
    let body;
    try {
      body = await request.json();
    } catch (e) {
      console.error("❌ Invalid JSON:", e.message);
      return Response.json(
        { status: "error", message: "Invalid JSON" },
        { status: 400, headers: getCorsHeaders(request) }
      );
    }

    const { variantId, quantity = 1, cartId, conversationId } = body;
    const origin = request.headers.get("Origin");
    let shopDomain = null;

    if (origin) {
      try {
        shopDomain = new URL(origin).hostname;
      } catch (e) {
        console.warn("❌ Could not parse Origin:", origin);
      }
    }

    if (!shopDomain) {
      console.error("❌ Missing shop domain");
      return Response.json(
        { status: "error", message: "Missing shop domain" },
        { status: 400, headers: getCorsHeaders(request) }
      );
    }

    if (!variantId) {
      console.error("❌ Missing variantId");
      return Response.json(
        { status: "error", message: "variantId is required" },
        { status: 400, headers: getCorsHeaders(request) }
      );
    }

    console.log(`\n🛒 CART API: Adding to cart`);
    console.log(`   - Shop: ${shopDomain}`);
    console.log(`   - Variant: ${variantId.substring(0, 40)}...`);
    console.log(`   - Cart: ${cartId ? 'existing' : 'new'}`);

    // Import modules
    const { default: MCPClient } = await import("../mcp-client");
    const { getCustomerAccountUrls } = await import("../db.server");
    const { createToolService } = await import("../services/tool.server");

    // Get customer MCP URL
    let customerMcpUrl = null;
    if (conversationId) {
      try {
        const urls = await getCustomerAccountUrls(conversationId);
        customerMcpUrl = urls?.mcpApiUrl;
      } catch (e) {
        console.warn("⚠️ Could not get customer MCP URL");
      }
    }

    // Initialize MCP client
    const client = new MCPClient(shopDomain, conversationId || `cart_${Date.now()}`, null, customerMcpUrl);

    // Connect to storefront MCP
    try {
      await client.connectToStorefrontServer();
    } catch (e) {
      console.error("❌ MCP connection failed:", e.message);
      return Response.json(
        { status: "error", message: "Failed to connect to MCP" },
        { status: 500, headers: getCorsHeaders(request) }
      );
    }

    // Ensure variant ID is in GID format
    let merchId = variantId;
    if (!merchId.startsWith("gid://")) {
      if (/^\d+$/.test(merchId)) {
        merchId = `gid://shopify/ProductVariant/${merchId}`;
      } else {
        // Assume it's already a GID without the prefix
        merchId = `gid://shopify/ProductVariant/${merchId}`;
      }
    }

    console.log(`   - Merchandise ID: ${merchId}`);

    // Update cart
    let result;
    try {
      result = await client.updateCart({
        cartId: cartId || undefined,
        lines: [{ 
          merchandise_id: merchId, 
          quantity: parseInt(quantity) || 1 
        }]
      });
      console.log("✅ Cart updated");
    } catch (e) {
      console.error("❌ updateCart failed:", e.message);
      return Response.json(
        { status: "error", message: `updateCart failed: ${e.message}` },
        { status: 500, headers: getCorsHeaders(request) }
      );
    }

    // Process result
    const toolService = createToolService();
    const { checkoutUrl: initialUrl, cart } = toolService.processCartUpdateResult(result);
    const newCartId = cart?.id;

    console.log(`   - New Cart ID: ${newCartId ? newCartId.substring(0, 30) + "..." : "null"}`);

    // Fetch cart if no checkout URL
    let finalCheckoutUrl = initialUrl;

    if (!finalCheckoutUrl && newCartId) {
      console.log("🔄 Fetching cart for checkout URL...");
      try {
        const cartResult = await client.getCart(newCartId);
        const parsed = toolService.processCartUpdateResult(cartResult);
        finalCheckoutUrl = parsed.checkoutUrl;
        console.log("✅ Got checkout URL from cart fetch");
      } catch (e) {
        console.warn("⚠️ Cart fetch failed:", e.message);
      }
    }

    // Normalize checkout URL
    if (finalCheckoutUrl) {
      finalCheckoutUrl = String(finalCheckoutUrl).trim();

      // Convert relative to absolute
      if (finalCheckoutUrl.startsWith("/")) {
        finalCheckoutUrl = `https://${shopDomain}${finalCheckoutUrl}`;
      }

      // Validate
      if (!finalCheckoutUrl.includes("/cart") && !finalCheckoutUrl.includes("/checkouts")) {
        console.warn("⚠️ Invalid checkout URL format");
        finalCheckoutUrl = null;
      }
    }

    if (!finalCheckoutUrl) {
      console.warn("⚠️ No checkout URL available");
    } else {
      console.log(`✅ Checkout URL: ${finalCheckoutUrl.substring(0, 60)}...`);
    }

    console.log(`\n✅ CART API SUCCESS\n`);

    return Response.json({
      status: "success",
      cartId: newCartId,
      checkoutUrl: finalCheckoutUrl,
      cartUrl: finalCheckoutUrl
    }, { 
      status: 200, 
      headers: getCorsHeaders(request) 
    });

  } catch (error) {
    console.error(`\n❌ CART API ERROR: ${error.message}\n`);
    
    return Response.json(
      { 
        status: "error", 
        message: error.message || "Failed to add to cart"
      },
      { 
        status: 500, 
        headers: getCorsHeaders(request) 
      }
    );
  }
}

function getCorsHeaders(request) {
  const origin = request.headers.get("Origin");
  
  return {
    "Access-Control-Allow-Origin": origin || "*",
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin"
  };
}
