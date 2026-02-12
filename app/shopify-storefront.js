/**
 * Shopify Storefront API Client
 * GraphQL wrapper for all Storefront operations
 */

export async function shopifyStorefrontQuery({ query, variables = {} }) {
  const endpoint = process.env.SHOPIFY_STOREFRONT_API;
  const token = process.env.SHOPIFY_STOREFRONT_TOKEN;
  const domain = process.env.SHOPIFY_DOMAIN;

  if (!endpoint || !token || !domain) {
    throw new Error(
      '❌ Missing Storefront API config: SHOPIFY_STOREFRONT_API, SHOPIFY_STOREFRONT_TOKEN, SHOPIFY_DOMAIN'
    );
  }

  console.log(`🔗 Storefront API Request: ${endpoint}`);
  console.log(`📝 Variables:`, JSON.stringify(variables).substring(0, 100));

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

    // Check for GraphQL errors
    if (json.errors) {
      console.error('❌ GraphQL Errors:', json.errors);
      throw new Error(json.errors[0]?.message || 'GraphQL error');
    }

    console.log('✅ Storefront API request succeeded');
    return json.data;

  } catch (error) {
    console.error('❌ Storefront API Error:', error.message);
    throw error;
  }
}
