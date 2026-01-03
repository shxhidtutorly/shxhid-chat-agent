/**
 * Leads API Route
 * Handles email capture for lead generation
 */

import { captureLeadEmail, hasVisitorProvidedEmail, createOrUpdateVisitor } from "../db.server";
import { ChatEvents } from "../services/posthog.server";

/**
 * Handle POST requests - Capture email
 */
export async function action({ request }) {
  if (request.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: getCorsHeaders(request)
    });
  }

  try {
    const body = await request.json();
    const {
      email,
      conversationId,
      visitorId,
      fingerprintId,
      captureSource = 'chat_popup',
      capturedPage,
      marketingConsent = false
    } = body;

    // Validate email
    if (!email || !isValidEmail(email)) {
      return new Response(JSON.stringify({ error: "Invalid email address" }), {
        status: 400,
        headers: getCorsHeaders(request)
      });
    }

    // Get shop info from headers
    const shopDomain = request.headers.get("Origin") || request.headers.get("Referer");
    const shopId = request.headers.get("X-Shopify-Shop-Id");

    // Capture the lead
    const lead = await captureLeadEmail({
      email: email.toLowerCase().trim(),
      shopDomain: shopDomain ? new URL(shopDomain).hostname : null,
      shopId,
      conversationId,
      captureSource,
      capturedPage,
      marketingConsent,
      visitorId
    });

    // Track with PostHog
    const trackingId = visitorId || fingerprintId || conversationId || email;
    ChatEvents.emailCaptured(trackingId, {
      email,
      shopDomain,
      conversationId,
      captureSource,
      marketingConsent,
    });

    return new Response(JSON.stringify({
      success: true,
      leadId: lead.id,
      message: "Thank you! We'll be in touch."
    }), {
      status: 200,
      headers: getCorsHeaders(request)
    });

  } catch (error) {
    console.error('Error capturing lead:', error);
    
    // Handle duplicate email gracefully
    if (error.code === 'P2002') {
      return new Response(JSON.stringify({
        success: true,
        message: "Email already registered."
      }), {
        status: 200,
        headers: getCorsHeaders(request)
      });
    }

    return new Response(JSON.stringify({ error: "Failed to save email" }), {
      status: 500,
      headers: getCorsHeaders(request)
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
      headers: getCorsHeaders(request)
    });
  }

  const url = new URL(request.url);
  const visitorId = url.searchParams.get('visitorId');
  const fingerprintId = url.searchParams.get('fingerprintId');

  if (!visitorId && !fingerprintId) {
    return new Response(JSON.stringify({ hasEmail: false }), {
      headers: getCorsHeaders(request)
    });
  }

  try {
    const hasEmail = await hasVisitorProvidedEmail(visitorId || fingerprintId);
    
    return new Response(JSON.stringify({ hasEmail }), {
      headers: getCorsHeaders(request)
    });
  } catch (error) {
    console.error('Error checking visitor email:', error);
    return new Response(JSON.stringify({ hasEmail: false }), {
      headers: getCorsHeaders(request)
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
    "Access-Control-Allow-Headers": "Content-Type, Accept, X-Shopify-Shop-Id",
    "Access-Control-Allow-Credentials": "true",
  };
}