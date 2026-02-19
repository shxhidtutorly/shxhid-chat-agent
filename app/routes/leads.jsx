/**
 * Leads API Route - FIXED VERSION
 */

export async function action({ request }) {
  // Handle OPTIONS
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: getCorsHeaders(request),
    });
  }

  if (request.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: getCorsHeaders(request),
    });
  }

  try {
    console.log("📧 Lead capture request received");

    // Server-only imports
    const dbMod = await import("../db.server");
    const captureLeadEmail = dbMod.captureLeadEmail;

    // Try to import analytics (optional)
    let ChatEvents = null;
    try {
      const posthogMod = await import("../services/posthog.server");
      ChatEvents = posthogMod.ChatEvents;
    } catch (e) {
      console.warn("Analytics not available");
    }

    const body = await request.json();
    const {
      email,
      conversationId,
      visitorId,
      fingerprintId,
      captureSource = "chat_popup",
      capturedPage,
      marketingConsent = false,
    } = body;

    // Validate email
    if (!email || !isValidEmail(email)) {
      return new Response(
        JSON.stringify({ error: "Invalid email address" }), 
        {
          status: 400,
          headers: getCorsHeaders(request),
        }
      );
    }

    // Get shop info — prefer proxy ?shop=, then POST body, then Origin header, then env
    const leadUrl = new URL(request.url);
    const shopFromProxy = leadUrl.searchParams.get("shop");
    const shopFromBody = body.shop_domain || null;
    const originHeader = request.headers.get("Origin") || request.headers.get("Referer");
    const shopFromOrigin = originHeader ? new URL(originHeader).hostname : null;
    const shopDomain = shopFromProxy || shopFromBody || shopFromOrigin || process.env.SHOPIFY_STORE_DOMAIN || "unknown";
    const shopId = request.headers.get("X-Shopify-Shop-Id") || null;

    console.log("📧 Saving lead:", email, "for shop:", shopDomain);

    // Save lead to database
    const lead = await captureLeadEmail({
      email: email.toLowerCase().trim(),
      shopDomain: shopDomain,
      shopId: shopId,
      conversationId: conversationId || null,
      captureSource,
      capturedPage: capturedPage || null,
      marketingConsent,
      visitorId: visitorId || null,
    });

    console.log("✅ Lead saved successfully:", lead.id);

    // Track analytics (non-blocking)
    if (ChatEvents) {
      try {
        const trackingId = visitorId || fingerprintId || conversationId || email;
        ChatEvents.emailCaptured(trackingId, {
          email,
          shopDomain,
          conversationId,
          captureSource,
          marketingConsent,
        });
      } catch (e) {
        console.warn("Analytics tracking failed:", e);
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        leadId: lead.id,
        message: "Thank you! We'll be in touch.",
      }),
      {
        status: 200,
        headers: getCorsHeaders(request),
      }
    );

  } catch (error) {
    console.error("❌ Error capturing lead:", error);

    // Handle duplicate email gracefully
    if (error?.code === "P2002" || error.message?.includes("Unique constraint")) {
      return new Response(
        JSON.stringify({
          success: true,
          message: "Email already registered.",
        }),
        {
          status: 200,
          headers: getCorsHeaders(request),
        }
      );
    }

    // Generic error response
    return new Response(
      JSON.stringify({ 
        error: "Failed to save email",
        details: process.env.NODE_ENV === "development" ? error.message : undefined
      }), 
      {
        status: 500,
        headers: getCorsHeaders(request),
      }
    );
  }
}

export async function loader({ request }) {
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: getCorsHeaders(request),
    });
  }

  const url = new URL(request.url);
  const visitorId = url.searchParams.get("visitorId");
  const fingerprintId = url.searchParams.get("fingerprintId");

  if (!visitorId && !fingerprintId) {
    return new Response(
      JSON.stringify({ hasEmail: false }), 
      {
        headers: getCorsHeaders(request),
      }
    );
  }

  try {
    const dbMod = await import("../db.server");
    const hasVisitorProvidedEmail = dbMod.hasVisitorProvidedEmail;

    const hasEmail = await hasVisitorProvidedEmail(visitorId || fingerprintId);

    return new Response(
      JSON.stringify({ hasEmail }), 
      {
        headers: getCorsHeaders(request),
      }
    );
  } catch (error) {
    console.error("Error checking visitor email:", error);
    return new Response(
      JSON.stringify({ hasEmail: false }), 
      {
        headers: getCorsHeaders(request),
      }
    );
  }
}

function isValidEmail(email) {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

function getCorsHeaders(request) {
  const origin = request.headers.get("Origin");
  const allowOrigin = origin || "*";
  return {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Accept, X-Shopify-Shop-Id",
    ...(origin ? { "Access-Control-Allow-Credentials": "true" } : {}),
  };
}
