/**
 * Shopify Storefront API Client
 * Auto-creates Storefront token via Admin API if not set in env
 * Retries on 401 with a fresh token
 */

const STORE_DOMAIN = process.env.SHOPIFY_STORE_DOMAIN || '';
const STOREFRONT_ENDPOINT = process.env.SHOPIFY_STOREFRONT_ENDPOINT ||
  (STORE_DOMAIN ? `https://${STORE_DOMAIN}/api/2025-10/graphql.json` : '');

// Token cache
let cachedToken = process.env.SHOPIFY_STOREFRONT_TOKEN || null;
let tokenCreatedViaAdmin = false;

/**
 * Get a valid Storefront API token.
 * Priority: env var > cached auto-created token > create new via Admin API
 */
async function getStorefrontToken() {
  if (cachedToken) return cachedToken;

  // Auto-create via Admin API
  return await createStorefrontTokenViaAdmin();
}

/**
 * Use the Admin API access token (from the Session table)
 * to create a Storefront access token automatically.
 */
async function createStorefrontTokenViaAdmin() {
  if (!STORE_DOMAIN) {
    throw new Error('SHOPIFY_STORE_DOMAIN env var is required');
  }

  const { default: prisma } = await import('./db.server.js');

  const session = await prisma.session.findFirst({
    where: { shop: STORE_DOMAIN },
    orderBy: { id: 'desc' },
  });

  if (!session?.accessToken) {
    throw new Error(`No admin session found for ${STORE_DOMAIN}. Install the app first.`);
  }

  console.log('🔑 Creating Storefront token via Admin API...');

  const response = await fetch(
    `https://${STORE_DOMAIN}/admin/api/2025-01/graphql.json`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': session.accessToken,
      },
      body: JSON.stringify({
        query: `mutation {
          storefrontAccessTokenCreate(input: { title: "Chat Agent Auto" }) {
            storefrontAccessToken { accessToken }
            userErrors { field message }
          }
        }`,
      }),
    }
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Admin API returned ${response.status}: ${text.substring(0, 200)}`);
  }

  const data = await response.json();
  const errors = data?.data?.storefrontAccessTokenCreate?.userErrors;

  if (errors?.length) {
    throw new Error(`Storefront token creation failed: ${errors[0].message}`);
  }

  const token = data?.data?.storefrontAccessTokenCreate?.storefrontAccessToken?.accessToken;
  if (!token) {
    throw new Error('Storefront token creation returned empty token');
  }

  cachedToken = token;
  tokenCreatedViaAdmin = true;
  console.log('✅ Storefront API token auto-created');
  return token;
}

/**
 * Invalidate the cached token so the next request will create a new one.
 */
function invalidateToken() {
  cachedToken = null;
  tokenCreatedViaAdmin = false;
}

/**
 * Execute a Storefront API GraphQL query/mutation.
 * Automatically handles token acquisition and 401 retry.
 */
export async function shopifyStorefrontQuery({ query, variables = {}, _retried = false }) {
  if (!STOREFRONT_ENDPOINT) {
    throw new Error('Storefront API endpoint not configured. Set SHOPIFY_STORE_DOMAIN env var.');
  }

  const token = await getStorefrontToken();

  const response = await fetch(STOREFRONT_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Storefront-Access-Token': token,
      'Accept': 'application/json',
    },
    body: JSON.stringify({ query, variables }),
  });

  if (!response.ok) {
    // On 401, try to auto-refresh token once
    if (response.status === 401 && !_retried) {
      console.warn('⚠️ Storefront token rejected (401), refreshing...');
      invalidateToken();
      return shopifyStorefrontQuery({ query, variables, _retried: true });
    }

    const errorText = await response.text();
    console.error(`❌ Storefront HTTP ${response.status}: ${errorText.substring(0, 200)}`);
    throw new Error(`Storefront API HTTP ${response.status}`);
  }

  const json = await response.json();

  if (json.errors) {
    const errorMsg = json.errors[0]?.message || 'Unknown GraphQL error';
    console.error('❌ Storefront GraphQL Error:', errorMsg);
    throw new Error(errorMsg);
  }

  return json.data;
}
