/**
 * Shopify Storefront API Client
 *
 * FIX: Config is NO LONGER read at module load time.
 * All env vars are read INSIDE the function at call time.
 * This prevents stale/wrong domain being baked in at startup.
 *
 * The shopDomain parameter allows per-request domain override,
 * which is required when the app serves multiple stores.
 */

// Validate and log config on startup (for diagnostics only - does NOT freeze config)
function validateAndLogConfig() {
    const storeDomain = process.env.SHOPIFY_STORE_DOMAIN;
    const token = process.env.SHOPIFY_STOREFRONT_TOKEN;
    const endpoint = process.env.SHOPIFY_STOREFRONT_ENDPOINT ||
          (storeDomain ? `https://${storeDomain}/api/2025-10/graphql.json` : '');

  const errors = [];
    if (!endpoint) errors.push('SHOPIFY_STOREFRONT_ENDPOINT (or SHOPIFY_STORE_DOMAIN)');
    if (!token) errors.push('SHOPIFY_STOREFRONT_TOKEN');
    if (!storeDomain) errors.push('SHOPIFY_STORE_DOMAIN');

  if (errors.length > 0) {
        console.error(`\u274C Missing env vars: ${errors.join(', ')}`);
        console.error('  Add these to your Railway variables');
        return;
  }

  if (token.includes('YOUR_ACTUAL_TOKEN')) {
        console.error('\u274C Storefront token is still a placeholder!');
        return;
  }

  console.log(`\n${'='.repeat(60)}`);
    console.log(`\u2705 Shopify Storefront API Initialized`);
    console.log(`  Endpoint: ${endpoint.substring(0, 50)}...`);
    console.log(`  Token: ${token.substring(0, 15)}...`);
    console.log(`  Domain: ${storeDomain}`);
    console.log(`${'='.repeat(60)}\n`);
}

// Run diagnostic on module load
validateAndLogConfig();

/**
 * Execute a Shopify Storefront GraphQL query.
 *
 * @param {Object} params
 * @param {string} params.query - GraphQL query string
 * @param {Object} [params.variables] - GraphQL variables
 * @param {string} [params.shopDomain] - Optional: override store domain for this request.
 *   If provided, the request targets this domain with the matching token.
 *   Falls back to SHOPIFY_STORE_DOMAIN env var.
 */
export async function shopifyStorefrontQuery({ query, variables = {}, shopDomain }) {
    // Read env vars at call time - never freeze at module load
  const envDomain = process.env.SHOPIFY_STORE_DOMAIN;
    const resolvedDomain = shopDomain || envDomain;

  if (!resolvedDomain) {
        throw new Error('\u274C No shop domain available. Pass shopDomain param or set SHOPIFY_STORE_DOMAIN env var.');
  }

  const token = process.env.SHOPIFY_STOREFRONT_TOKEN;
    if (!token) {
          throw new Error('\u274C SHOPIFY_STOREFRONT_TOKEN is not set.');
    }

  // Warn if request domain does not match env domain (cross-store leak detection)
  if (shopDomain && envDomain && shopDomain !== envDomain) {
        console.warn(`\u26A0\uFE0F shopifyStorefrontQuery: shopDomain=${shopDomain} differs from env SHOPIFY_STORE_DOMAIN=${envDomain}. Token may not be valid for this domain.`);
  }

  const endpoint = process.env.SHOPIFY_STOREFRONT_ENDPOINT ||
        `https://${resolvedDomain}/api/2025-10/graphql.json`;

  console.log(`\uD83D\uDD17 Storefront GraphQL \u2192 ${endpoint.substring(0, 60)}`);

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
                        console.error('\u274C UNAUTHORIZED (401) - Invalid or expired Storefront token');
                        console.error(`  Domain: ${resolvedDomain}`);
                        console.error(`  Token prefix: ${token.substring(0, 15)}...`);
                        console.error('  Fix: Get a new Storefront API token from Shopify Admin > Apps > Develop apps > Storefront API credentials');
                        throw new Error('Invalid Storefront API token - check your environment variables');
              }
              console.error(`\u274C HTTP ${response.status}: ${errorText.substring(0, 100)}`);
              throw new Error(`HTTP ${response.status} - ${response.statusText}`);
      }

      const json = await response.json();
        if (json.errors) {
                const errorMsg = json.errors[0]?.message || 'Unknown GraphQL error';
                console.error('\u274C GraphQL Error:', errorMsg);
                throw new Error(errorMsg);
        }

      console.log('\u2705 Storefront API Success');
        return json.data;
  } catch (error) {
        console.error('\u274C Storefront API Error:', error.message);
        throw error;
  }
}
