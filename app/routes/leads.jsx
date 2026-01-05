/**
 * Leads API Route
 * Handles email capture for lead generation
 */

/**
 * Handle POST requests - Capture email
 */
export async function action({ request }) {
  if (request.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: getCorsHeaders(request),
    });
  }

  try {
    // 🔑 Server-only imports (SAFE)
    const {
      captureLeadEmail,
    } = await import("../db.server");
    const { ChatEvents } = await import("../services/posthog.server");

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

    if (!email || !isValidEmail(email)) {
      return new Response(JSON.stringify({ error: "Invalid email address" }), {
        status: 400,
        headers: getCorsHeaders(request),
      });
    }

    const shopDomain =
      request.headers.get("Origin") || request.headers.get("Referer");
    const shopId = request.headers.get("X-Shopify-Shop-Id");

    const lead = await captureLeadEmail({
      email: email.toLowerCase().trim(),
      shopDomain: shopDomain ? new URL(shopDomain).hostname : null,
      shopId,
      conversationId,
      captureSource,
      capturedPage,
      marketingConsent,
      visitorId,
    });

    const trackingId =
      visitorId || fingerprintId || conversationId || email;

    ChatEvents.emailCaptured(trackingId, {
      email,
      shopDomain,
      conversationId,
      captureSource,
      marketingConsent,
    });

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
    console.error("Error capturing lead:", error);

    if (error?.code === "P2002") {
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

    return new Response(JSON.stringify({ error: "Failed to save email" }), {
      status: 500,
      headers: getCorsHeaders(request),
    });
  }
}

/**
 * Handle GET requests - Check if email already captured
 */
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
    return new Response(JSON.stringify({ hasEmail: false }), {
      headers: getCorsHeaders(request),
    });
  }

  try {
    // 🔑 Server-only import (SAFE)
    const {
      hasVisitorProvidedEmail,
    } = await import("../db.server");

    const hasEmail = await hasVisitorProvidedEmail(
      visitorId || fingerprintId
    );

    return new Response(JSON.stringify({ hasEmail }), {
      headers: getCorsHeaders(request),
    });
  } catch (error) {
    console.error("Error checking visitor email:", error);
    return new Response(JSON.stringify({ hasEmail: false }), {
      headers: getCorsHeaders(request),
    });
  }
}

/**
 * Validate email format
 */
function isValidEmail(email) {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

/**
 * Get CORS headers
 */
function getCorsHeaders(request) {
  const origin = request.headers.get("Origin") || "*";
  return {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers":
      "Content-Type, Accept, X-Shopify-Shop-Id",
    "Access-Control-Allow-Credentials": "true",
  };
}
