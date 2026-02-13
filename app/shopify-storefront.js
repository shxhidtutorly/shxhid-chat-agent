/**
 * Shopify Storefront API Client
 * ✅ FIXED: Uses cartCheckoutUrl instead of checkoutUrl (as per Shopify docs)
 */

const STOREFRONT_TOKEN = 'shpat_YOUR_ACTUAL_TOKEN_HERE';

const SHOPIFY_CONFIG = {
  endpoint: 'https://shahid-ai-agent.myshopify.com/api/2024-01/graphql.json',
  token: STOREFRONT_TOKEN,
  domain: 'shahid-ai-agent.myshopify.com'
};

console.log(`\n${'='.repeat(60)}`);
console.log(`✅ Shopify Storefront API Initialized`);
console.log(`   Endpoint: ${SHOPIFY_CONFIG.endpoint.substring(0, 50)}...`);
console.log(`   Token: ${SHOPIFY_CONFIG.token.substring(0, 15)}...`);
console.log(`   Domain: ${SHOPIFY_CONFIG.domain}`);
console.log(`${'='.repeat(60)}\n`);

export async function shopifyStorefrontQuery({ query, variables = {} }) {
  const { endpoint, token, domain } = SHOPIFY_CONFIG;

  if (!endpoint || !token || !domain) {
    throw new Error('❌ Shopify config missing');
  }

  console.log(`🔗 Storefront GraphQL Request`);

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
      const errorText = await response.text();
      console.error(`❌ HTTP ${response.status}: ${errorText.substring(0, 100)}`);
      throw new Error(`HTTP ${response.status} - ${response.statusText}`);
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
