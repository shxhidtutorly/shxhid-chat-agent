/**
 * Shopify Storefront API Client
 *
 * - Auto-creates Storefront token via Admin API if not set
 * - Caches token in-memory
 * - Retries once on 401 with a fresh token
 * - Reads env vars at call time (no frozen config)
 * - Supports per-request shopDomain override
 */

// ------------------------------
// Token cache (in-memory)
// ------------------------------
let cachedToken = process.env.SHOPIFY_STOREFRONT_TOKEN || null;
let tokenCreatedViaAdmin = false;

// ------------------------------
// Helpers
// ------------------------------
function getStoreDomain() {
  return process.env.SHOPIFY_STORE_DOMAIN || '';
}

function getStorefrontEndpoint(domain) {
  if (!domain) return '';
  return (
    process.env.SHOPIFY_STOREFRONT_ENDPOINT ||
    `https://${domain}/api/2025-10/graphql.json`
  );
}

// ------------------------------
// Storefront token management
// ------------------------------
async function getStorefrontToken() {
  if (cachedToken) return cachedToken;
  return createStorefrontTokenViaAdmin();
}

async function createStorefrontTokenViaAdmin() {
  const storeDomain = getStoreDomain();
  if (!storeDomain) {
    throw new Error('SHOPIFY_STORE_DOMAIN env var is required');
  }

  const { default: prisma } = await import('./db.server.js');

  const session = await prisma.session.findFirst({
    where: { shop: storeDomain },
    orderBy: { id: 'desc' },
  });

  if (!session?.accessToken) {
    throw new Error(
      `No admin session found for ${storeDomain}. Install the app first.`
    );
  }

  console.log('🔑 Creating Storefront token via Admin API…');

  const response = await fetch(
    `https://${storeDomain}/admin/api/2025-01/graphql.json`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': session.accessToken,
      },
      body: JSON.stringify({
        query: `
          mutation {
            storefrontAccessTokenCreate(input: { title: "Chat Agent Auto" }) {
              storefrontAccessToken { accessToken }
              userErrors { field message }
            }
          }
        `,
      }),
    }
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `Admin API returned ${response.status}: ${text.slice(0, 200)}`
    );
  }

  const json = await response.json();
  const errors =
    json?.data?.storefrontAccessTokenCreate?.userErrors || [];

  if (errors.length) {
    throw new Error(`Storefront token creation failed: ${errors[0].message}`);
  }

  const token =
    json?.data?.storefrontAccessTokenCreate?.storefrontAccessToken
      ?.accessToken;

  if (!token) {
    throw new Error('Storefront token creation returned empty token');
  }

  cachedToken = token;
  tokenCreatedViaAdmin = true;

  console.log('✅ Storefront API token auto-created');
  return token;
}

function invalidateToken() {
  cachedToken = null;
  tokenCreatedViaAdmin = false;
}

// ------------------------------
// Optional startup diagnostics
// ------------------------------
function validateAndLogConfig() {
  const storeDomain = getStoreDomain();
  const token = process.env.SHOPIFY_STOREFRONT_TOKEN;
  const endpoint = getStorefrontEndpoint(storeDomain);

  const missing = [];
  if (!storeDomain) missing.push('SHOPIFY_STORE_DOMAIN');
  if (!endpoint) missing.push('SHOPIFY_STOREFRONT_ENDPOINT');
  if (!token && !cachedToken) missing.push('SHOPIFY_STOREFRONT_TOKEN');

  if (missing.length) {
    console.error(`❌ Missing env vars: ${missing.join(', ')}`);
    return;
  }

  console.log('\n' + '='.repeat(60));
  console.log('✅ Shopify Storefront API Initialized');
  console.log(`  Domain: ${storeDomain}`);
  console.log(`  Endpoint: ${endpoint.slice(0, 60)}…`);
  if (token) console.log(`  Token: ${token.slice(0, 15)}…`);
  console.log('='.repeat(60) + '\n');
}

// Safe to run on module load (diagnostics only)
validateAndLogConfig();

// ------------------------------
// Public API
// ------------------------------
export async function shopifyStorefrontQuery({
  query,
  variables = {},
  shopDomain,
  _retried = false,
}) {
  const envDomain = getStoreDomain();
  const resolvedDomain = shopDomain || envDomain;

  if (!resolvedDomain) {
    throw new Error(
      'No shop domain available. Pass shopDomain or set SHOPIFY_STORE_DOMAIN.'
    );
  }

  const endpoint = getStorefrontEndpoint(resolvedDomain);
  if (!endpoint) {
    throw new Error('Storefront endpoint could not be resolved.');
  }

  let token = process.env.SHOPIFY_STOREFRONT_TOKEN;

  if (!token) {
    token = await getStorefrontToken();
  }

  if (shopDomain && envDomain && shopDomain !== envDomain) {
    console.warn(
      `⚠️ shopDomain (${shopDomain}) differs from env SHOPIFY_STORE_DOMAIN (${envDomain}). Token may be invalid.`
    );
  }

  console.log(`🔗 Storefront GraphQL → ${endpoint.slice(0, 60)}…`);

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Storefront-Access-Token': token,
      Accept: 'application/json',
    },
    body: JSON.stringify({ query, variables }),
  });

  if (!response.ok) {
    if (response.status === 401 && !_retried) {
      console.warn('⚠️ Storefront token rejected (401), refreshing…');
      invalidateToken();
      return shopifyStorefrontQuery({
        query,
        variables,
        shopDomain,
        _retried: true,
      });
    }

    const text = await response.text();
    console.error(`❌ Storefront HTTP ${response.status}: ${text.slice(0, 200)}`);
    throw new Error(`Storefront API HTTP ${response.status}`);
  }

  const json = await response.json();

  if (json.errors) {
    const message = json.errors[0]?.message || 'Unknown GraphQL error';
    console.error('❌ Storefront GraphQL Error:', message);
    throw new Error(message);
  }

  return json.data;
}
