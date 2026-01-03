/**
 * Database Server Module - PostgreSQL with Railway
 * Handles all database operations for chat, leads, and analytics
 */

import { PrismaClient } from "@prisma/client";

// Singleton pattern for Prisma client
const globalForPrisma = globalThis;

if (!globalForPrisma.prisma) {
  globalForPrisma.prisma = new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
  });
}

const prisma = globalForPrisma.prisma;

export default prisma;

// ============================================
// VISITOR & LEAD MANAGEMENT
// ============================================

/**
 * Create or update a visitor
 * @param {Object} visitorData - Visitor information
 * @returns {Promise<Object>} - The visitor record
 */
export async function createOrUpdateVisitor({
  fingerprintId,
  sessionId,
  shopDomain,
  userAgent,
  ipAddress,
  utmSource,
  utmMedium,
  utmCampaign,
  utmTerm,
  utmContent
}) {
  try {
    if (fingerprintId) {
      // Try to find existing visitor by fingerprint
      const existing = await prisma.visitor.findUnique({
        where: { fingerprintId }
      });

      if (existing) {
        // Update existing visitor
        return await prisma.visitor.update({
          where: { fingerprintId },
          data: {
            lastSeenAt: new Date(),
            visitCount: { increment: 1 },
            sessionId,
            userAgent,
            // Only update UTM if provided
            ...(utmSource && { utmSource }),
            ...(utmMedium && { utmMedium }),
            ...(utmCampaign && { utmCampaign }),
            ...(utmTerm && { utmTerm }),
            ...(utmContent && { utmContent }),
          }
        });
      }
    }

    // Create new visitor
    return await prisma.visitor.create({
      data: {
        fingerprintId,
        sessionId,
        shopDomain,
        userAgent,
        ipAddress,
        utmSource,
        utmMedium,
        utmCampaign,
        utmTerm,
        utmContent,
      }
    });
  } catch (error) {
    console.error('Error creating/updating visitor:', error);
    throw error;
  }
}

/**
 * Capture lead email
 * @param {Object} leadData - Lead information
 * @returns {Promise<Object>} - The lead record
 */
export async function captureLeadEmail({
  email,
  shopDomain,
  shopId,
  conversationId,
  captureSource = 'chat_popup',
  capturedPage,
  marketingConsent = false,
  visitorId
}) {
  try {
    // Create lead record
    const lead = await prisma.lead.upsert({
      where: {
        email_shopDomain: { email, shopDomain }
      },
      create: {
        email,
        shopDomain,
        shopId,
        conversationId,
        captureSource,
        capturedPage,
        marketingConsent,
      },
      update: {
        conversationId,
        capturedPage,
        marketingConsent,
        updatedAt: new Date(),
      }
    });

    // Update visitor if we have visitorId
    if (visitorId) {
      await prisma.visitor.update({
        where: { id: visitorId },
        data: {
          email,
          emailCapturedAt: new Date(),
          leadStatus: 'LEAD',
        }
      });
    }

    // Track analytics event
    if (conversationId) {
      await trackAnalyticsEvent({
        conversationId,
        eventType: 'EMAIL_CAPTURED',
        eventData: { email, captureSource },
        shopDomain,
      });
    }

    return lead;
  } catch (error) {
    console.error('Error capturing lead email:', error);
    throw error;
  }
}

/**
 * Get leads for a shop
 * @param {string} shopDomain - Shop domain
 * @param {Object} options - Query options
 * @returns {Promise<Array>} - List of leads
 */
export async function getLeadsByShop(shopDomain, { limit = 100, offset = 0, status } = {}) {
  try {
    return await prisma.lead.findMany({
      where: {
        shopDomain,
        ...(status && { status }),
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: offset,
    });
  } catch (error) {
    console.error('Error getting leads:', error);
    return [];
  }
}

/**
 * Check if visitor has provided email
 * @param {string} visitorId - Visitor ID or fingerprint
 * @returns {Promise<boolean>}
 */
export async function hasVisitorProvidedEmail(visitorId) {
  try {
    const visitor = await prisma.visitor.findFirst({
      where: {
        OR: [
          { id: visitorId },
          { fingerprintId: visitorId },
          { sessionId: visitorId }
        ]
      },
      select: { email: true }
    });
    return !!visitor?.email;
  } catch (error) {
    console.error('Error checking visitor email:', error);
    return false;
  }
}

// ============================================
// CONVERSATION MANAGEMENT
// ============================================

/**
 * Create or update a conversation in the database
 * @param {string} conversationId - The conversation ID
 * @param {Object} options - Additional options
 * @returns {Promise<Object>} - The created or updated conversation
 */
export async function createOrUpdateConversation(conversationId, {
  visitorId,
  shopDomain,
  shopId,
  title
} = {}) {
  try {
    const existingConversation = await prisma.conversation.findUnique({
      where: { id: conversationId }
    });

    if (existingConversation) {
      return await prisma.conversation.update({
        where: { id: conversationId },
        data: {
          updatedAt: new Date(),
          ...(title && { title }),
        }
      });
    }

    const conversation = await prisma.conversation.create({
      data: {
        id: conversationId,
        visitorId,
        shopDomain,
        shopId,
        title: title || 'Chat',
      }
    });

    // Update visitor stats if available
    if (visitorId) {
      await prisma.visitor.update({
        where: { id: visitorId },
        data: {
          totalChats: { increment: 1 },
          leadStatus: 'ENGAGED',
        }
      }).catch(console.error);
    }

    // Track analytics
    await trackAnalyticsEvent({
      conversationId,
      eventType: 'CHAT_STARTED',
      shopDomain,
    });

    return conversation;
  } catch (error) {
    console.error('Error creating/updating conversation:', error);
    throw error;
  }
}

/**
 * End a conversation
 * @param {string} conversationId - The conversation ID
 */
export async function endConversation(conversationId) {
  try {
    await prisma.conversation.update({
      where: { id: conversationId },
      data: {
        status: 'ENDED',
        endedAt: new Date(),
      }
    });

    await trackAnalyticsEvent({
      conversationId,
      eventType: 'CHAT_ENDED',
    });
  } catch (error) {
    console.error('Error ending conversation:', error);
  }
}

/**
 * Get conversation with messages
 * @param {string} conversationId - The conversation ID
 * @returns {Promise<Object|null>}
 */
export async function getConversationWithMessages(conversationId) {
  try {
    return await prisma.conversation.findUnique({
      where: { id: conversationId },
      include: {
        messages: {
          orderBy: { createdAt: 'asc' }
        },
        visitor: {
          select: {
            id: true,
            email: true,
            leadStatus: true,
          }
        }
      }
    });
  } catch (error) {
    console.error('Error getting conversation:', error);
    return null;
  }
}

// ============================================
// MESSAGE MANAGEMENT
// ============================================

/**
 * Save a message to the database
 * @param {string} conversationId - The conversation ID
 * @param {string} role - The message role (user or assistant)
 * @param {string} content - The message content
 * @param {Object} options - Additional options
 * @returns {Promise<Object>} - The saved message
 */
export async function saveMessage(conversationId, role, content, {
  contentType = 'TEXT',
  toolName,
  tokenCount,
  responseTimeMs,
  shopDomain,
  visitorId
} = {}) {
  try {
    // Ensure the conversation exists
    await createOrUpdateConversation(conversationId, { shopDomain, visitorId });

    // Create the message
    const message = await prisma.message.create({
      data: {
        conversationId,
        role,
        content,
        contentType,
        toolName,
        tokenCount,
        responseTimeMs,
      }
    });

    // Update conversation stats
    await prisma.conversation.update({
      where: { id: conversationId },
      data: {
        messageCount: { increment: 1 },
        ...(toolName && { toolCallCount: { increment: 1 } }),
        updatedAt: new Date(),
      }
    });

    // Update visitor stats if available
    if (visitorId && role === 'user') {
      await prisma.visitor.update({
        where: { id: visitorId },
        data: {
          totalMessages: { increment: 1 },
          lastSeenAt: new Date(),
        }
      }).catch(console.error);
    }

    // Track analytics
    await trackAnalyticsEvent({
      conversationId,
      eventType: role === 'user' ? 'MESSAGE_SENT' : 'MESSAGE_RECEIVED',
      eventData: { role, contentType, toolName },
      shopDomain,
    });

    return message;
  } catch (error) {
    console.error('Error saving message:', error);
    throw error;
  }
}

/**
 * Get conversation history
 * @param {string} conversationId - The conversation ID
 * @returns {Promise<Array>} - Array of messages in the conversation
 */
export async function getConversationHistory(conversationId) {
  try {
    const messages = await prisma.message.findMany({
      where: { conversationId },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        role: true,
        content: true,
        contentType: true,
        toolName: true,
        createdAt: true,
      }
    });

    return messages;
  } catch (error) {
    console.error('Error retrieving conversation history:', error);
    return [];
  }
}

/**
 * Get recent conversations for a visitor
 * @param {string} visitorId - Visitor ID
 * @param {number} limit - Max conversations to return
 * @returns {Promise<Array>}
 */
export async function getVisitorConversations(visitorId, limit = 20) {
  try {
    return await prisma.conversation.findMany({
      where: { visitorId },
      orderBy: { updatedAt: 'desc' },
      take: limit,
      include: {
        messages: {
          take: 1,
          orderBy: { createdAt: 'desc' },
          select: {
            content: true,
            role: true,
          }
        }
      }
    });
  } catch (error) {
    console.error('Error getting visitor conversations:', error);
    return [];
  }
}

// ============================================
// ANALYTICS TRACKING
// ============================================

/**
 * Track an analytics event
 * @param {Object} eventData - Event data
 */
export async function trackAnalyticsEvent({
  conversationId,
  eventType,
  eventData,
  shopDomain,
  userAgent
}) {
  try {
    await prisma.chatAnalytics.create({
      data: {
        conversationId,
        eventType,
        eventData,
        shopDomain,
        userAgent,
      }
    });
  } catch (error) {
    // Don't throw - analytics should not break the main flow
    console.error('Error tracking analytics event:', error);
  }
}

/**
 * Get analytics summary for a shop
 * @param {string} shopDomain - Shop domain
 * @param {Object} options - Query options
 * @returns {Promise<Object>}
 */
export async function getAnalyticsSummary(shopDomain, { startDate, endDate } = {}) {
  try {
    const where = {
      shopDomain,
      ...(startDate && endDate && {
        createdAt: {
          gte: startDate,
          lte: endDate,
        }
      })
    };

    const [totalConversations, totalMessages, totalLeads, eventCounts] = await Promise.all([
      prisma.conversation.count({ where: { shopDomain } }),
      prisma.message.count({
        where: { conversation: { shopDomain } }
      }),
      prisma.lead.count({ where: { shopDomain } }),
      prisma.chatAnalytics.groupBy({
        by: ['eventType'],
        where,
        _count: { id: true }
      })
    ]);

    return {
      totalConversations,
      totalMessages,
      totalLeads,
      eventCounts: eventCounts.reduce((acc, e) => {
        acc[e.eventType] = e._count.id;
        return acc;
      }, {}),
    };
  } catch (error) {
    console.error('Error getting analytics summary:', error);
    return null;
  }
}

// ============================================
// AUTHENTICATION (OAuth/PKCE)
// ============================================

/**
 * Store a code verifier for PKCE authentication
 * @param {string} state - The state parameter used in OAuth flow
 * @param {string} verifier - The code verifier to store
 * @returns {Promise<Object>} - The saved code verifier object
 */
export async function storeCodeVerifier(state, verifier) {
  const expiresAt = new Date();
  expiresAt.setMinutes(expiresAt.getMinutes() + 10);

  try {
    return await prisma.codeVerifier.create({
      data: {
        id: `cv_${Date.now()}`,
        state,
        verifier,
        expiresAt
      }
    });
  } catch (error) {
    console.error('Error storing code verifier:', error);
    throw error;
  }
}

/**
 * Get a code verifier by state parameter
 * @param {string} state - The state parameter used in OAuth flow
 * @returns {Promise<Object|null>} - The code verifier object or null if not found
 */
export async function getCodeVerifier(state) {
  try {
    const verifier = await prisma.codeVerifier.findFirst({
      where: {
        state,
        expiresAt: { gt: new Date() }
      }
    });

    if (verifier) {
      // Delete after retrieval to prevent reuse
      await prisma.codeVerifier.delete({
        where: { id: verifier.id }
      });
    }

    return verifier;
  } catch (error) {
    console.error('Error retrieving code verifier:', error);
    return null;
  }
}

/**
 * Store a customer access token
 * @param {string} conversationId - The conversation ID
 * @param {string} accessToken - The access token
 * @param {Date} expiresAt - Token expiration
 * @returns {Promise<Object>}
 */
export async function storeCustomerToken(conversationId, accessToken, expiresAt) {
  try {
    const existingToken = await prisma.customerToken.findFirst({
      where: { conversationId }
    });

    if (existingToken) {
      return await prisma.customerToken.update({
        where: { id: existingToken.id },
        data: {
          accessToken,
          expiresAt,
          updatedAt: new Date()
        }
      });
    }

    return await prisma.customerToken.create({
      data: {
        id: `ct_${Date.now()}`,
        conversationId,
        accessToken,
        expiresAt,
      }
    });
  } catch (error) {
    console.error('Error storing customer token:', error);
    throw error;
  }
}

/**
 * Get a customer access token
 * @param {string} conversationId - The conversation ID
 * @returns {Promise<Object|null>}
 */
export async function getCustomerToken(conversationId) {
  try {
    return await prisma.customerToken.findFirst({
      where: {
        conversationId,
        expiresAt: { gt: new Date() }
      }
    });
  } catch (error) {
    console.error('Error retrieving customer token:', error);
    return null;
  }
}

/**
 * Store customer account URLs
 */
export async function storeCustomerAccountUrls({ conversationId, mcpApiUrl, authorizationUrl, tokenUrl }) {
  try {
    return await prisma.customerAccountUrls.upsert({
      where: { conversationId },
      create: {
        conversationId,
        mcpApiUrl,
        authorizationUrl,
        tokenUrl,
      },
      update: {
        mcpApiUrl,
        authorizationUrl,
        tokenUrl,
        updatedAt: new Date(),
      },
    });
  } catch (error) {
    console.error('Error storing customer account URLs:', error);
    throw error;
  }
}

/**
 * Get customer account URLs
 * @param {string} conversationId - The conversation ID
 * @returns {Promise<Object|null>}
 */
export async function getCustomerAccountUrls(conversationId) {
  try {
    return await prisma.customerAccountUrls.findUnique({
      where: { conversationId }
    });
  } catch (error) {
    console.error('Error retrieving customer account URLs:', error);
    return null;
  }
}

// ============================================
// CLEANUP UTILITIES
// ============================================

/**
 * Clean up expired data
 */
export async function cleanupExpiredData() {
  try {
    const now = new Date();
    
    // Delete expired code verifiers
    await prisma.codeVerifier.deleteMany({
      where: { expiresAt: { lt: now } }
    });

    // Delete expired customer tokens
    await prisma.customerToken.deleteMany({
      where: { expiresAt: { lt: now } }
    });

    console.log('Cleanup completed successfully');
  } catch (error) {
    console.error('Error during cleanup:', error);
  }
}