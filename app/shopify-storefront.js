/**
 * Shopify Storefront API Client (PRODUCTION SAFE)
 *
 * Token acquisition:
 *   1. Use SHOPIFY_STOREFRONT_TOKEN env var if set (only on first load)
 *   2. If env token returns 401: permanently discard it, never use again
 *   3. Auto-create via Admin REST API:
 *      POST /admin/api/{version}/storefront_access_tokens.json
 *   4. Cache the new token in-memory for process lifetime
 *
 * Official docs:
 * - https://shopify.dev/docs/api/admin-rest/latest/resources/storefrontaccesstoken
 * - https://shopify.dev/docs/api/storefront/latest#authentication
 */

const API_VERSION = process.env.SHOPIFY_API_VERSION || '2025-01';
const STORE_DOMAIN = process.env.SHOPIFY_STORE_DOMAIN || '';

const STOREFRONT_ENDPOINT = STORE_DOMAIN
  ? `https://${STORE_DOMAIN}/api/${API_VERSION}/graphql.json`
  : '';

// In-memory cache (per process). Initialized ONCE from env var.
// After that, only the cache is used — env var is NEVER re-read at call time.
let cachedToken = process.env.SHOPIFY_STOREFRONT_TOKEN || null;
let envTokenDiscarded = false; // Set true after env token returns 401 — never use env token again

// Startup diagnostics
if (!STORE_DOMAIN) {
  console.error(
    '[Storefront] SHOPIFY_STORE_DOMAIN not set. Storefront features will fail.'
  );
} else {
  console.log(
    `[Storefront] Initialized | domain=${STORE_DOMAIN} | api=${API_VERSION} | token=${
      cachedToken ? 'env' : 'auto-create'
    }`
  );
}

// -----------------------------------------------------------------------------
// Token management
// -----------------------------------------------------------------------------

/**
 * Get a valid Storefront API access token.
 * Uses cached token or auto-creates via Admin REST API.
 * NEVER re-reads process.env at call time.
 */
async function getStorefrontToken() {
  if (cachedToken) return cachedToken;
  console.log('[Storefront] No cached token — creating via Admin REST API...');
  return await createStorefrontTokenViaAdminRest();
}

/**
 * Permanently invalidate the cached Storefront token.
 * If the env var token caused the 401, mark it as permanently discarded.
 */
function invalidateToken() {
  if (process.env.SHOPIFY_STOREFRONT_TOKEN && !envTokenDiscarded) {
    console.error(
      '[Storefront] SHOPIFY_STOREFRONT_TOKEN env var returned 401 — PERMANENTLY DISCARDING. ' +
      'Will auto-create a fresh token via Admin REST API.'
    );
    envTokenDiscarded = true;
  }
  cachedToken = null;
}

/**
 * Create a Storefront access token via Admin REST API.
 * POST /admin/api/{version}/storefront_access_tokens.json
 */
async function createStorefrontTokenViaAdminRest() {
  if (!STORE_DOMAIN) {
    throw new Error('[Storefront] Missing SHOPIFY_STORE_DOMAIN');
  }

  const { default: prisma } = await import('./db.server.js');

  const session = await prisma.session.findFirst({
    where: { shop: STORE_DOMAIN },
    orderBy: { id: 'desc' },
  });

  if (!session?.accessToken) {
    throw new Error(
      `[Storefront] No Admin API token found for ${STORE_DOMAIN}. App must be installed.`
    );
  }

  console.log('[Storefront] Creating Storefront token via Admin REST API...');

  const response = await fetch(
    `https://${STORE_DOMAIN}/admin/api/${API_VERSION}/storefront_access_tokens.json`,
    {
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
    }
  );

  if (!response.ok) {
    const text = await response.text();
    console.error(
      `[Storefront] Admin REST API ${response.status}: ${text.slice(0, 300)}`
    );

    if (response.status === 403) {
      throw new Error(
        '[Storefront] Admin token lacks permission. Ensure unauthenticated_* scopes and reinstall.'
      );
    }

    throw new Error(
      `[Storefront] Failed to create Storefront token (${response.status})`
    );
  }

  const json = await response.json();
  const token = json?.storefront_access_token?.access_token;

  if (!token) {
    throw new Error(
      '[Storefront] Token creation succeeded but no token returned'
    );
  }

  cachedToken = token;
  console.log('[Storefront] Storefront token created successfully via Admin REST API');

  return token;
}

// -----------------------------------------------------------------------------
// Public API
// -----------------------------------------------------------------------------

/**
 * Execute a Storefront API GraphQL query/mutation.
 * Uses cached token or auto-creates one. Retries once on 401.
 */
export async function shopifyStorefrontQuery({
  query,
  variables = {},
  shopDomain,
  _retried = false,
}) {
  const domain = shopDomain || STORE_DOMAIN;

  if (!domain) {
    throw new Error(
      '[Storefront] No shop domain available. Pass shopDomain or set SHOPIFY_STORE_DOMAIN env.'
    );
  }

  const endpoint = `https://${domain}/api/${API_VERSION}/graphql.json`;

  // CRITICAL: Always use the cached token system. NEVER re-read env var at call time.
  const token = await getStorefrontToken();

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'X-Shopify-Storefront-Access-Token': token,
    },
    body: JSON.stringify({ query, variables }),
  });

  // On 401: permanently discard the failing token and retry with a fresh one
  if (response.status === 401 && !_retried) {
    console.warn('[Storefront] 401 — token rejected. Discarding and creating fresh token via Admin REST API...');
    invalidateToken();
    return shopifyStorefrontQuery({
      query,
      variables,
      shopDomain,
      _retried: true,
    });
  }

  if (!response.ok) {
    const text = await response.text();
    console.error(
      `[Storefront] HTTP ${response.status}: ${text.slice(0, 300)}`
    );
    throw new Error(`Storefront API HTTP ${response.status}`);
  }

  const json = await response.json();

  if (json.errors?.length) {
    const message = json.errors[0]?.message || 'Unknown GraphQL error';
    console.error('[Storefront] GraphQL Error:', message);
    throw new Error(message);
  }

  return json.data;
}
