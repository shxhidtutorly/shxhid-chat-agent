/**
 * Shopify Storefront API Client
 * GraphQL wrapper - with Railway environment variable support
 */

// ✅ HARDCODED FALLBACK (temporary while we set up Railway)
const SHOPIFY_CONFIG = {
  endpoint: process.env.SHOPIFY_STOREFRONT_API || 'https://shahid-ai-agent.myshopify.com/api/2024-01/graphql.json',
  token: process.env.SHOPIFY_STOREFRONT_TOKEN || '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', 
  domain: process.env.SHOPIFY_DOMAIN || 'shahid-ai-agent.myshopify.com'
};

console.log(`\n✅ Shopify Config Loaded:`);
console.log(`   Endpoint: ${SHOPIFY_CONFIG.endpoint.substring(0, 60)}...`);
console.log(`   Token: ${SHOPIFY_CONFIG.token.substring(0, 20)}...`);
console.log(`   Domain: ${SHOPIFY_CONFIG.domain}\n`);

export async function shopifyStorefrontQuery({ query, variables = {} }) {
  const { endpoint, token, domain } = SHOPIFY_CONFIG;

  if (!endpoint || !token || !domain) {
    throw new Error('❌ Shopify config missing');
  }

  console.log(`🔗 Storefront API Query`);

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Storefront-Access-Token': token,
        'Accept': 'application/json'
      },
      body: JSON.stringify({ query, variables })
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const json = await response.json();

    if (json.errors) {
      console.error('❌ GraphQL Error:', json.errors[0]?.message);
      throw new Error(json.errors[0]?.message || 'GraphQL error');
    }

    console.log('✅ Storefront API Success');
    return json.data;

  } catch (error) {
    console.error('❌ Storefront API Error:', error.message);
    throw error;
  }
}
