/**
 * Shopify Storefront API Client
 * ✅ FIXED: Proper token management and error handling
 */

const SHOPIFY_CONFIG = {
  endpoint: process.env.SHOPIFY_STOREFRONT_ENDPOINT || 'creativeautomation.myshopify.com/api/2024-01/graphql.json',
  token: process.env.SHOPIFY_STOREFRONT_TOKEN, // ✅ NOW from env var
  domain: process.env.SHOPIFY_STORE_DOMAIN || 'creativeautomation.myshopify.com'
};

// ✅ Validate config on startup
function validateConfig() {
  const errors = [];
  
  if (!SHOPIFY_CONFIG.endpoint) errors.push('SHOPIFY_STOREFRONT_ENDPOINT');
  if (!SHOPIFY_CONFIG.token) errors.push('SHOPIFY_STOREFRONT_TOKEN');
  if (!SHOPIFY_CONFIG.domain) errors.push('SHOPIFY_STORE_DOMAIN');

  if (errors.length > 0) {
    console.error(`❌ Missing env vars: ${errors.join(', ')}`);
    console.error('   Add these to your .env file or Railway variables');
    return false;
  }

  if (SHOPIFY_CONFIG.token.includes('YOUR_ACTUAL_TOKEN')) {
    console.error('❌ Storefront token is still a placeholder!');
    return false;
  }

  console.log(`\n${'='.repeat(60)}`);
  console.log(`✅ Shopify Storefront API Initialized`);
  console.log(`   Endpoint: ${SHOPIFY_CONFIG.endpoint.substring(0, 50)}...`);
  console.log(`   Token: ${SHOPIFY_CONFIG.token.substring(0, 15)}...`);
  console.log(`   Domain: ${SHOPIFY_CONFIG.domain}`);
  console.log(`${'='.repeat(60)}\n`);
  
  return true;
}

// Validate on module load
const isConfigValid = validateConfig();

export async function shopifyStorefrontQuery({ query, variables = {} }) {
  if (!isConfigValid) {
    throw new Error('❌ Shopify config is invalid. Check your environment variables.');
  }

  const { endpoint, token, domain } = SHOPIFY_CONFIG;

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
      
      if (response.status === 401) {
        console.error('❌ UNAUTHORIZED (401) - Invalid or expired Storefront token');
        console.error('   Fix: Get new token from Shopify Admin > Settings > Apps and integrations > Develop apps > Storefront API credentials');
        throw new Error('Invalid Storefront API token - check your environment variables');
      }
      
      console.error(`❌ HTTP ${response.status}: ${errorText.substring(0, 100)}`);
      throw new Error(`HTTP ${response.status} - ${response.statusText}`);
    }

    const json = await response.json();

    if (json.errors) {
      const errorMsg = json.errors[0]?.message || 'Unknown GraphQL error';
      console.error('❌ GraphQL Error:', errorMsg);
      throw new Error(errorMsg);
    }

    console.log('✅ Storefront API Success');
    return json.data;

  } catch (error) {
    console.error('❌ Storefront API Error:', error.message);
    throw error;
  }
}
