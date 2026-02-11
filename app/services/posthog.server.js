/**
 * PostHog Analytics Service (SERVER-ONLY)
 * Safe for React Router 7 
 */

let posthogClient = null;

/**
 * Lazily initialize PostHog client
 * Ensures this file never breaks builds if PostHog is unavailable
 */
function getPostHogClient() {
  if (posthogClient) return posthogClient;

  const apiKey = process.env.POSTHOG_API_KEY;
  if (!apiKey) {
    // Analytics disabled if key is missing
    return null;
  }

  try {
    // Lazy require to keep this server-only
    // eslint-disable-next-line global-require
    const { PostHog } = require("posthog-node");

    posthogClient = new PostHog(apiKey, {
      host: process.env.POSTHOG_HOST || "https://app.posthog.com",
      flushAt: 20,
      flushInterval: 10000,
    });

    return posthogClient;
  } catch (error) {
    console.warn("PostHog not initialized:", error?.message || error);
    posthogClient = null;
    return null;
  }
}

/* -------------------------------------------------
   Core helpers
-------------------------------------------------- */

function safeCapture(distinctId, event, properties = {}) {
  const client = getPostHogClient();
  if (!client || !distinctId) return;

  try {
    client.capture({
      distinctId: String(distinctId),
      event,
      properties: {
        ...properties,
        source: "shop-chat-agent",
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error("PostHog capture error:", error);
  }
}

function safeIdentify(distinctId, properties = {}) {
  const client = getPostHogClient();
  if (!client || !distinctId) return;

  try {
    client.identify({
      distinctId: String(distinctId),
      properties: {
        $set: {
          ...properties,
          source: "shop-chat-agent",
        },
      },
    });
  } catch (error) {
    console.error("PostHog identify error:", error);
  }
}

/* -------------------------------------------------
   Public API
-------------------------------------------------- */

export function identifyUser(distinctId, properties = {}) {
  safeIdentify(distinctId, properties);
}

export function trackEvent(distinctId, event, properties = {}) {
  safeCapture(distinctId, event, properties);
}

/**
 * Chat-specific events
 * Matches your existing usage exactly
 */
export const ChatEvents = {
  chatStarted: (id, props) => safeCapture(id, "Chat Started", props),
  chatEnded: (id, props) => safeCapture(id, "Chat Ended", props),

  messageSent: (id, props) => safeCapture(id, "Message Sent", props),
  messageReceived: (id, props) => safeCapture(id, "Message Received", props),

  toolCalled: (id, props) => safeCapture(id, "Tool Called", props),

  productViewed: (id, props) => safeCapture(id, "Product Viewed", props),
  productAddedToCart: (id, props) =>
    safeCapture(id, "Product Added to Cart", props),
  checkoutInitiated: (id, props) =>
    safeCapture(id, "Checkout Initiated", props),

  emailCaptured: (id, props) => safeCapture(id, "Email Captured", props),
  emailPopupShown: (id, props) =>
    safeCapture(id, "Email Popup Shown", props),
  emailPopupDismissed: (id, props) =>
    safeCapture(id, "Email Popup Dismissed", props),

  authRequired: (id, props) => safeCapture(id, "Auth Required", props),
  authCompleted: (id, props) => safeCapture(id, "Auth Completed", props),

  errorOccurred: (id, props) => safeCapture(id, "Error Occurred", props),
};

export function setUserProperties(distinctId, properties = {}) {
  safeIdentify(distinctId, properties);
}

export function incrementUserProperty(distinctId, property, value = 1) {
  safeCapture(distinctId, "$set", {
    $set: {
      [`${property}_count`]: value,
    },
  });
}

export function trackPageView(distinctId, properties = {}) {
  safeCapture(distinctId, "$pageview", properties);
}

export async function flushEvents() {
  const client = getPostHogClient();
  if (!client) return;
  try {
    await client.flush();
  } catch (error) {
    console.error("PostHog flush error:", error);
  }
}

export async function shutdown() {
  const client = getPostHogClient();
  if (!client) return;
  try {
    await client.shutdown();
  } catch (error) {
    console.error("PostHog shutdown error:", error);
  }
}

export default {
  identifyUser,
  trackEvent,
  ChatEvents,
  setUserProperties,
  incrementUserProperty,
  trackPageView,
  flushEvents,
  shutdown,
};
