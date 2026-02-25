/**
 * Shopify Storefront API Client (PRODUCTION SAFE)
 *
 * ✔ Dev Dashboard compatible
 * ✔ Creates Storefront token via Admin REST API
 * ✔ Caches token in-memory
 * ✔ Retries once on 401
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

// In-memory cache (per process)
let cachedToken = process.env.SHOPIFY_STOREFRONT_TOKEN || null;

// -----------------------------------------------------------------------------
// Startup diagnostics (safe, no secrets)
// -----------------------------------------------------------------------------
if (!STORE_DOMAIN) {
  console.error(
    '[Storefront] ❌ SHOPIFY_STORE_DOMAIN not set. Storefront features will fail.'
  );
} else {
  console.log(
    `[Storefront] Initialized | domain=${STORE_DOMAIN} | api=${API_VERSION} | token=${
      cachedToken ? 'env' : 'auto-create'
    }`
  );
}

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------
function invalidateToken() {
  if (process.env.SHOPIFY_STOREFRONT_TOKEN) {
    console.error(
      '[Storefront] ❌ Env Storefront token rejected (401). Fix or remove env var.'
    );
  }
  cachedToken = null;
}

// -----------------------------------------------------------------------------
// Storefront token management (Admin REST API ONLY)
// -----------------------------------------------------------------------------
async function getStorefrontToken() {
  if (cachedToken) return cachedToken;
  return createStorefrontTokenViaAdminRest();
}

async function createStorefrontTokenViaAdminRest() {
  if (!STORE_DOMAIN) {
    throw new Error('[Storefront] Missing SHOPIFY_STORE_DOMAIN');
  }

  const { default: prisma } = await import('./db.server.js');

  // Get latest offline admin session (created during OAuth install)
  const session = await prisma.session.findFirst({
    where: { shop: STORE_DOMAIN },
    orderBy: { id: 'desc' },
  });

  if (!session?.accessToken) {
    throw new Error(
      `[Storefront] No Admin API token found for ${STORE_DOMAIN}. App must be installed.`
    );
  }

  console.log('[Storefront] 🔑 Creating Storefront token via Admin REST API');

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
      `[Storefront] ❌ Admin REST API ${response.status}: ${text.slice(0, 300)}`
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
  console.log('[Storefront] ✅ Storefront token created successfully');

  return token;
}

// -----------------------------------------------------------------------------
// Public API
// -----------------------------------------------------------------------------
export async function shopifyStorefrontQuery({
  query,
  variables = {},
  shopDomain,
  _retried = false,
}) {
  const domain = shopDomain || STORE_DOMAIN;

  if (!domain) {
    throw new Error(
      '[Storefront] No shop domain available. Pass shopDomain or set env.'
    );
  }

  const endpoint = `https://${domain}/api/${API_VERSION}/graphql.json`;

  let token = process.env.SHOPIFY_STOREFRONT_TOKEN;
  if (!token) {
    token = await getStorefrontToken();
  }

  console.log(`🔗 Storefront GraphQL → ${endpoint}`);

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'X-Shopify-Storefront-Access-Token': token,
    },
    body: JSON.stringify({ query, variables }),
  });

  // Retry once on 401
  if (response.status === 401 && !_retried) {
    console.warn('[Storefront] ⚠️ 401 received. Refreshing token and retrying.');
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
      `[Storefront] ❌ HTTP ${response.status}: ${text.slice(0, 300)}`
    );
    throw new Error(`Storefront API HTTP ${response.status}`);
  }

  const json = await response.json();

  if (json.errors?.length) {
    const message = json.errors[0]?.message || 'Unknown GraphQL error';
    console.error('[Storefront] ❌ GraphQL Error:', message);
    throw new Error(message);
  }

  return json.data;
}