// app/db.server.js
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
      return await prisma.visitor.upsert({
        where: { fingerprintId },
        create: {
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
        },
        update: {
          lastSeenAt: new Date(),
          visitCount: { increment: 1 },
          sessionId,
          userAgent,
          ...(utmSource && { utmSource }),
          ...(utmMedium && { utmMedium }),
          ...(utmCampaign && { utmCampaign }),
          ...(utmTerm && { utmTerm }),
          ...(utmContent && { utmContent }),
        }
      });
    }

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
    // 1. Create/Update Lead Record
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

    // 2. Link to Visitor (Fixes P2025 Error)
    // We use upsert to ensure we don't crash if the visitor ID is missing
    if (visitorId) {
      await prisma.visitor.upsert({
        where: { id: visitorId },
        create: {
          id: visitorId,
          email,
          shopDomain: shopDomain || 'unknown',
          emailCapturedAt: new Date(),
          leadStatus: 'LEAD',
        },
        update: {
          email,
          emailCapturedAt: new Date(),
          leadStatus: 'LEAD',
        }
      }).catch(err => console.warn("Visitor upsert warning:", err.message));
    }

    // 3. Track Analytics
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
// CONVERSATION & MESSAGE MANAGEMENT
// ============================================

export async function createOrUpdateConversation(conversationId, {
  visitorId,
  shopDomain,
  shopId,
  title
} = {}) {
  try {
    return await prisma.conversation.upsert({
      where: { id: conversationId },
      create: {
        id: conversationId,
        visitorId,
        shopDomain,
        shopId,
        title: title || 'Chat',
      },
      update: {
        updatedAt: new Date(),
        ...(title && { title }),
      }
    });
  } catch (error) {
    console.error('Error creating/updating conversation:', error);
    throw error;
  }
}

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

export async function saveMessage(conversationId, role, content, {
  contentType = 'TEXT',
  toolName,
  tokenCount,
  responseTimeMs,
  shopDomain,
  visitorId
} = {}) {
  try {
    // Ensure visitor exists first
    if (visitorId) {
      await prisma.visitor.upsert({
        where: { id: visitorId },
        create: { id: visitorId, shopDomain: shopDomain || 'unknown' },
        update: { lastSeenAt: new Date() }
      }).catch(e => null);
    }

    // Ensure conversation exists
    await createOrUpdateConversation(conversationId, { shopDomain, visitorId });

    // Create message
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

    // Update stats
    await prisma.conversation.update({
      where: { id: conversationId },
      data: {
        messageCount: { increment: 1 },
        ...(toolName && { toolCallCount: { increment: 1 } }),
        updatedAt: new Date(),
      }
    });

    return message;
  } catch (error) {
    console.error('Error saving message:', error);
    throw error;
  }
}

export async function getConversationHistory(conversationId) {
  try {
    return await prisma.message.findMany({
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
  } catch (error) {
    console.error('Error retrieving conversation history:', error);
    return [];
  }
}

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
          select: { content: true, role: true }
        }
      }
    });
  } catch (error) {
    console.error('Error getting visitor conversations:', error);
    return [];
  }
}

// ============================================
// ANALYTICS & AUTH
// ============================================

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
    console.error('Error tracking analytics event:', error);
  }
}

export async function getAnalyticsSummary(shopDomain, { startDate, endDate } = {}) {
  try {
    const where = {
      shopDomain,
      ...(startDate && endDate && {
        createdAt: { gte: startDate, lte: endDate }
      })
    };

    const [totalConversations, totalMessages, totalLeads, eventCounts] = await Promise.all([
      prisma.conversation.count({ where: { shopDomain } }),
      prisma.message.count({ where: { conversation: { shopDomain } } }),
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

export async function storeCodeVerifier(state, verifier) {
  const expiresAt = new Date();
  expiresAt.setMinutes(expiresAt.getMinutes() + 10);
  return await prisma.codeVerifier.create({
    data: { id: `cv_${Date.now()}`, state, verifier, expiresAt }
  });
}

export async function getCodeVerifier(state) {
  try {
    const verifier = await prisma.codeVerifier.findFirst({
      where: { state, expiresAt: { gt: new Date() } }
    });
    if (verifier) await prisma.codeVerifier.delete({ where: { id: verifier.id } });
    return verifier;
  } catch (error) { return null; }
}

export async function storeCustomerToken(conversationId, accessToken, expiresAt) {
  const existingToken = await prisma.customerToken.findFirst({ where: { conversationId } });
  if (existingToken) {
    return await prisma.customerToken.update({
      where: { id: existingToken.id },
      data: { accessToken, expiresAt, updatedAt: new Date() }
    });
  }
  return await prisma.customerToken.create({
    data: { id: `ct_${Date.now()}`, conversationId, accessToken, expiresAt }
  });
}

export async function getCustomerToken(conversationId) {
  return await prisma.customerToken.findFirst({
    where: { conversationId, expiresAt: { gt: new Date() } }
  });
}

export async function storeCustomerAccountUrls({ conversationId, mcpApiUrl, authorizationUrl, tokenUrl }) {
  return await prisma.customerAccountUrls.upsert({
    where: { conversationId },
    create: { conversationId, mcpApiUrl, authorizationUrl, tokenUrl },
    update: { mcpApiUrl, authorizationUrl, tokenUrl, updatedAt: new Date() },
  });
}

export async function getCustomerAccountUrls(conversationId) {
  return await prisma.customerAccountUrls.findUnique({ where: { conversationId } });
}

export async function cleanupExpiredData() {
  try {
    const now = new Date();
    await prisma.codeVerifier.deleteMany({ where: { expiresAt: { lt: now } } });
    await prisma.customerToken.deleteMany({ where: { expiresAt: { lt: now } } });
  } catch (error) {
    console.error('Error during cleanup:', error);
  }
}
