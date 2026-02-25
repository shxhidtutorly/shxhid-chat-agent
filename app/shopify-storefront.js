/**
 * Shopify Storefront API Client
 *
 * Token acquisition:
 *   1. Use SHOPIFY_STOREFRONT_TOKEN env var if set
 *   2. Auto-create via Admin REST API:
 *      POST /admin/api/{version}/storefront_access_tokens.json
 *      Requires: admin access token from Session table (set during app install)
 *   3. On 401, invalidate cached token and retry once
 *
 * Ref: https://shopify.dev/docs/api/admin-rest/latest/resources/storefrontaccesstoken
 * Ref: https://shopify.dev/docs/api/storefront/latest#authentication
 */

const API_VERSION = process.env.SHOPIFY_API_VERSION || '2025-01';
const STORE_DOMAIN = process.env.SHOPIFY_STORE_DOMAIN || '';
const STOREFRONT_ENDPOINT = process.env.SHOPIFY_STOREFRONT_ENDPOINT ||
  (STORE_DOMAIN ? `https://${STORE_DOMAIN}/api/${API_VERSION}/graphql.json` : '');

// In-memory token cache (survives across requests in same process)
let cachedToken = process.env.SHOPIFY_STOREFRONT_TOKEN || null;

// Startup validation
if (!STORE_DOMAIN) {
  console.error('[Storefront] SHOPIFY_STORE_DOMAIN is not set. Cart and product features will fail.');
} else {
  console.log(
    `[Storefront] domain=${STORE_DOMAIN} api=${API_VERSION} ` +
    `token=${cachedToken ? 'env' : 'will-auto-create'} ` +
    `endpoint=${STOREFRONT_ENDPOINT.substring(0, 60)}`
  );
}

/**
 * Get a valid Storefront API access token.
 */
async function getStorefrontToken() {
  if (cachedToken) return cachedToken;
  return await createTokenViaAdminRestApi();
}

/**
 * Create a Storefront access token using the Admin REST API.
 *
 * POST https://{shop}/admin/api/{version}/storefront_access_tokens.json
 * Header: X-Shopify-Access-Token: {admin_access_token}
 * Body: { storefront_access_token: { title: "..." } }
 *
 * The admin access token comes from the Session table (stored during OAuth install).
 */
async function createTokenViaAdminRestApi() {
  if (!STORE_DOMAIN) {
    throw new Error(
      '[Storefront] Cannot create token: SHOPIFY_STORE_DOMAIN env var is not set.'
    );
  }

  const { default: prisma } = await import('./db.server.js');

  // Get the admin access token from the most recent offline session
  const session = await prisma.session.findFirst({
    where: { shop: STORE_DOMAIN },
    orderBy: { id: 'desc' },
  });

  if (!session?.accessToken) {
    throw new Error(
      `[Storefront] No admin session found for ${STORE_DOMAIN}. ` +
      'The Shopify app must be installed on the store first (OAuth flow).'
    );
  }

  console.log(`[Storefront] Creating token via Admin REST API (${API_VERSION})...`);

  const url = `https://${STORE_DOMAIN}/admin/api/${API_VERSION}/storefront_access_tokens.json`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': session.accessToken,
    },
    body: JSON.stringify({
      storefront_access_token: {
        title: 'Chat Agent Storefront Token',
      },
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    console.error(`[Storefront] Admin REST API ${response.status}: ${text.substring(0, 300)}`);

    if (response.status === 403) {
      throw new Error(
        '[Storefront] Admin token lacks permission to create Storefront tokens. ' +
        'Ensure the app has unauthenticated_* scopes in shopify.app.toml and reinstall.'
      );
    }

    throw new Error(
      `[Storefront] Failed to create token: Admin REST API returned ${response.status}`
    );
  }

  const data = await response.json();
  const token = data?.storefront_access_token?.access_token;

  if (!token) {
    console.error('[Storefront] Admin REST API response missing token:', JSON.stringify(data).substring(0, 300));
    throw new Error('[Storefront] Token creation succeeded but response contained no token.');
  }

  cachedToken = token;
  console.log('[Storefront] Token created successfully via Admin REST API');
  return token;
}

/**
 * Invalidate the cached Storefront token.
 */
function invalidateToken() {
  if (process.env.SHOPIFY_STOREFRONT_TOKEN) {
    console.error(
      '[Storefront] SHOPIFY_STOREFRONT_TOKEN env var returned 401. ' +
      'The token may be revoked or incorrect. ' +
      'Either fix the env var or remove it to enable auto-creation via Admin REST API.'
    );
  }
  cachedToken = null;
}

/**
 * Execute a Storefront API GraphQL query/mutation.
 * Handles token acquisition and automatic 401 retry.
 */
export async function shopifyStorefrontQuery({ query, variables = {}, _retried = false }) {
  if (!STOREFRONT_ENDPOINT) {
    throw new Error(
      '[Storefront] Endpoint not configured. Set SHOPIFY_STORE_DOMAIN env var.'
    );
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

  // On 401, try refreshing the token once
  if (response.status === 401 && !_retried) {
    console.warn('[Storefront] Token rejected (401), attempting auto-refresh...');
    invalidateToken();
    return shopifyStorefrontQuery({ query, variables, _retried: true });
  }

  if (!response.ok) {
    const errorText = await response.text();
    console.error(`[Storefront] HTTP ${response.status}: ${errorText.substring(0, 300)}`);
    throw new Error(`Storefront API returned HTTP ${response.status}`);
  }

  const json = await response.json();

  if (json.errors) {
    const errorMsg = json.errors[0]?.message || 'Unknown GraphQL error';
    console.error(`[Storefront] GraphQL error: ${errorMsg}`);
    throw new Error(errorMsg);
  }

  return json.data;
}
