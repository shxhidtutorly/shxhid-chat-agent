/**
 * PostHog Analytics Service
 * Server-side analytics tracking with PostHog
 */

import { PostHog } from 'posthog-node';

// Initialize PostHog client
let posthog = null;

function getPostHogClient() {
  if (!posthog && process.env.POSTHOG_API_KEY) {
    posthog = new PostHog(process.env.POSTHOG_API_KEY, {
      host: process.env.POSTHOG_HOST || 'https://app.posthog.com',
      flushAt: 20,
      flushInterval: 10000,
    });
  }
  return posthog;
}

/**
 * Identify a user/visitor
 * @param {string} distinctId - Unique identifier for the user
 * @param {Object} properties - User properties
 */
export function identifyUser(distinctId, properties = {}) {
  const client = getPostHogClient();
  if (!client) return;

  try {
    client.identify({
      distinctId,
      properties: {
        ...properties,
        $set: properties,
        source: 'shop-chat-agent',
      }
    });
  } catch (error) {
    console.error('PostHog identify error:', error);
  }
}

/**
 * Track an event
 * @param {string} distinctId - User identifier
 * @param {string} event - Event name
 * @param {Object} properties - Event properties
 */
export function trackEvent(distinctId, event, properties = {}) {
  const client = getPostHogClient();
  if (!client) return;

  try {
    client.capture({
      distinctId,
      event,
      properties: {
        ...properties,
        timestamp: new Date().toISOString(),
        source: 'shop-chat-agent',
      }
    });
  } catch (error) {
    console.error('PostHog capture error:', error);
  }
}

/**
 * Track chat events
 */
export const ChatEvents = {
  // Chat lifecycle events
  chatStarted: (distinctId, props) => trackEvent(distinctId, 'Chat Started', props),
  chatEnded: (distinctId, props) => trackEvent(distinctId, 'Chat Ended', props),
  
  // Message events
  messageSent: (distinctId, props) => trackEvent(distinctId, 'Message Sent', props),
  messageReceived: (distinctId, props) => trackEvent(distinctId, 'Message Received', props),
  
  // Tool events
  toolCalled: (distinctId, props) => trackEvent(distinctId, 'Tool Called', props),
  
  // Product events
  productViewed: (distinctId, props) => trackEvent(distinctId, 'Product Viewed', props),
  productAddedToCart: (distinctId, props) => trackEvent(distinctId, 'Product Added to Cart', props),
  checkoutInitiated: (distinctId, props) => trackEvent(distinctId, 'Checkout Initiated', props),
  
  // Lead events
  emailCaptured: (distinctId, props) => trackEvent(distinctId, 'Email Captured', props),
  emailPopupShown: (distinctId, props) => trackEvent(distinctId, 'Email Popup Shown', props),
  emailPopupDismissed: (distinctId, props) => trackEvent(distinctId, 'Email Popup Dismissed', props),
  
  // Auth events
  authRequired: (distinctId, props) => trackEvent(distinctId, 'Auth Required', props),
  authCompleted: (distinctId, props) => trackEvent(distinctId, 'Auth Completed', props),
  
  // Error events
  errorOccurred: (distinctId, props) => trackEvent(distinctId, 'Error Occurred', props),
};

/**
 * Set user properties
 * @param {string} distinctId - User identifier
 * @param {Object} properties - Properties to set
 */
export function setUserProperties(distinctId, properties) {
  const client = getPostHogClient();
  if (!client) return;

  try {
    client.identify({
      distinctId,
      properties: {
        $set: properties,
      }
    });
  } catch (error) {
    console.error('PostHog setUserProperties error:', error);
  }
}

/**
 * Increment a user property
 * @param {string} distinctId - User identifier
 * @param {string} property - Property name
 * @param {number} value - Value to increment by
 */
export function incrementUserProperty(distinctId, property, value = 1) {
  const client = getPostHogClient();
  if (!client) return;

  try {
    client.capture({
      distinctId,
      event: '$set',
      properties: {
        $set: {
          [`${property}_count`]: value,
        }
      }
    });
  } catch (error) {
    console.error('PostHog incrementUserProperty error:', error);
  }
}

/**
 * Track page view
 * @param {string} distinctId - User identifier
 * @param {Object} properties - Page properties
 */
export function trackPageView(distinctId, properties = {}) {
  const client = getPostHogClient();
  if (!client) return;

  try {
    client.capture({
      distinctId,
      event: '$pageview',
      properties: {
        ...properties,
        source: 'shop-chat-agent',
      }
    });
  } catch (error) {
    console.error('PostHog pageview error:', error);
  }
}

/**
 * Flush all pending events
 */
export async function flushEvents() {
  const client = getPostHogClient();
  if (!client) return;

  try {
    await client.flush();
  } catch (error) {
    console.error('PostHog flush error:', error);
  }
}

/**
 * Shutdown PostHog client gracefully
 */
export async function shutdown() {
  const client = getPostHogClient();
  if (!client) return;

  try {
    await client.shutdown();
  } catch (error) {
    console.error('PostHog shutdown error:', error);
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