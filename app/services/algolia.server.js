/**
 * Algolia Search Service — v3.1 (Production Fix)
 *
 * CHANGES (v3.1 — May 2026):
 *
 * FIX 1: "undefined" string image — some Algolia records have the literal
 *   string "undefined" (not null) as product_image. Added explicit check:
 *   `hit.product_image !== 'undefined'` to reject this invalid value.
 *
 * FIX 2: Result count — changed default `first` from 20 to 10. Sending 20
 *   product cards overwhelms the chat UI. 10 is sufficient for the user to
 *   browse and ask follow-up questions.
 *
 * CONFIRMED field shapes from Algolia dashboard (May 2026):
 *   product_image  → string URL (the image field) — may be "undefined" string for some records
 *   price          → integer in AED (e.g. 4437)
 *   sku            → string at top level
 *   id / objectID  → numeric Shopify product ID
 *   handle         → product handle string
 *   variants       → NOT present in index (product-level index)
 *
 * Since variant IDs are not in the Algolia index, we batch-fetch them
 * from the Storefront API after getting Algolia results.
 */

let _client = null;

async function getClient() {
  if (_client) return _client;

  const appId = process.env.ALGOLIA_APP_ID;
  const apiKey = process.env.ALGOLIA_SEARCH_KEY;

  if (!appId || !apiKey) {
    throw new Error('[Algolia] ALGOLIA_APP_ID and ALGOLIA_SEARCH_KEY must be set');
  }

  const mod = await import('algoliasearch');
  const algoliasearch = mod.algoliasearch || mod.default;

  if (typeof algoliasearch !== 'function') {
    throw new Error(
      `[Algolia] Cannot find constructor. Keys: [${Object.keys(mod).join(', ')}]. Run: npm install algoliasearch`
    );
  }

  _client = algoliasearch(appId, apiKey);
  console.log('[Algolia] Client initialized');
  return _client;
}

export function isAlgoliaConfigured() {
  return !!(process.env.ALGOLIA_APP_ID && process.env.ALGOLIA_SEARCH_KEY);
}

/**
 * Fetch first variant IDs for a list of product handles from Storefront API.
 * Returns a Map of handle → { variantId, variantSku }
 */
async function fetchVariantIdsByHandles(handles, shopDomain) {
  if (!handles || handles.length === 0) return new Map();

  const { shopifyStorefrontQuery } = await import('../shopify-storefront.js');
  const variantMap = new Map();

  const batchSize = 15;
  const BATCH_QUERY = `
    query GetVariantsByHandles($queryStr: String!, $count: Int!) {
      products(first: $count, query: $queryStr) {
        edges {
          node {
            handle
            variants(first: 1) {
              edges {
                node {
                  id
                  sku
                  availableForSale
                  price { amount currencyCode }
                }
              }
            }
          }
        }
      }
    }
  `;

  const SINGLE_QUERY = `
    query GetVariantByHandle($handle: String!) {
      productByHandle(handle: $handle) {
        handle
        variants(first: 1) {
          edges {
            node {
              id
              sku
              availableForSale
              price { amount currencyCode }
            }
          }
        }
      }
    }
  `;

  // Step 1: batch fetch
  for (let i = 0; i < handles.length; i += batchSize) {
    const batch = handles.slice(i, i + batchSize).filter(Boolean);
    if (batch.length === 0) continue;

    try {
      const queryStr = batch.map(h => `handle:"${h}"`).join(' OR ');
      const data = await shopifyStorefrontQuery({
        query: BATCH_QUERY,
        variables: { queryStr, count: batch.length + 5 },
        shopDomain,
      });

      for (const { node } of data?.products?.edges || []) {
        const firstVariant = node.variants?.edges?.[0]?.node;
        if (firstVariant && node.handle) {
          variantMap.set(node.handle, {
            variantId: firstVariant.id,
            variantSku: firstVariant.sku || null,
          });
        }
      }
    } catch (err) {
      console.warn(`[Algolia] Batch variant fetch failed: ${err.message}`);
    }
  }

  // Step 2: per-handle fallback for anything the batch missed
  const missing = handles.filter(h => h && !variantMap.has(h));

  if (missing.length > 0) {
    console.log(`[Algolia] Per-handle fallback for ${missing.length} missed: ${missing.join(', ')}`);
    await Promise.allSettled(
      missing.map(async (handle) => {
        try {
          const data = await shopifyStorefrontQuery({
            query: SINGLE_QUERY,
            variables: { handle },
            shopDomain,
          });
          const product = data?.productByHandle;
          if (product) {
            const firstVariant = product.variants?.edges?.[0]?.node;
            if (firstVariant) {
              variantMap.set(handle, {
                variantId: firstVariant.id,
                variantSku: firstVariant.sku || null,
              });
            }
          }
        } catch (err) {
          console.warn(`[Algolia] Single handle fetch failed for "${handle}": ${err.message}`);
        }
      })
    );
  }

  const stillMissing = handles.filter(h => h && !variantMap.has(h));
  if (stillMissing.length > 0) {
    console.warn(`[Algolia] Variant IDs unresolvable: ${stillMissing.join(', ')}`);
  }
  console.log(`[Algolia] Variant IDs resolved: ${variantMap.size}/${handles.length}`);

  return variantMap;
}

/**
 * Helper: determine if a product_image field value is a valid URL.
 *
 * Some Algolia records store the literal string "undefined" instead of null
 * when the image was missing at sync time. We must reject this value.
 */
function isValidImageUrl(value) {
  if (!value) return false;
  if (typeof value !== 'string') return false;
  if (value === 'undefined' || value === 'null') return false; // literal strings
  return value.startsWith('http');
}

export async function algoliaSearch(query, { first = 10, shopDomain } = {}) {
  if (!query || typeof query !== 'string') return null;
  const trimmed = query.trim();
  if (!trimmed) return null;

  // Detect if this looks like a SKU/part code — if so, search EXACTLY as-is
  const looksLikeSku = /^[A-Z0-9]{2,}[-\.][A-Z0-9][-A-Z0-9\.\/]{2,}$/i.test(trimmed) ||
    (/^[A-Z]{2,}\d{2,}/.test(trimmed) && trimmed.length >= 5 && trimmed.length <= 20);

  if (looksLikeSku) {
    console.log(`[Algolia] SKU query detected — searching exact: "${trimmed}"`);
  }

  const indexName = process.env.ALGOLIA_INDEX_NAME || 'shopify_products';
  console.log(`[Algolia] Searching: "${trimmed}" in "${indexName}"`);

  let client;
  try {
    client = await getClient();
  } catch (err) {
    console.error(`[Algolia] Client init failed: ${err.message}`);
    return null;
  }

  let hits = [];
  try {
    const response = await client.search({
      requests: [{
        indexName,
        query: trimmed,
        hitsPerPage: first,  // v3.1: was hardcoded 20, now uses param (default 10)
        attributesToRetrieve: [
          'objectID', 'id', 'title', 'handle', 'vendor',
          'product_type', 'tags', 'body_html', 'body_html_safe',
          'price', 'variants_min_price', 'variants_max_price', 'currency_code',
          'product_image', 'image', 'featured_image', 'images',
          'variants', 'sku', 'named_tags',
        ],
        ...(looksLikeSku ? {
          optionalWords: [],
          typoTolerance: false,
        } : {
          typoTolerance: true,
        }),
      }],
    });
    hits = response.results?.[0]?.hits || [];
  } catch (searchErr) {
    const msg = searchErr.message || '';
    if (
      msg.includes('does not exist') ||
      msg.includes('Index not found') ||
      searchErr.status === 404
    ) {
      console.warn(
        `[Algolia] Index "${indexName}" not found. ` +
        `Sync at dashboard.algolia.com → Data Sources → Integrations → Shopify`
      );
      return null;
    }
    console.error(`[Algolia] Search error: ${msg}`);
    return null;
  }

  if (hits.length === 0) {
    console.log(`[Algolia] 0 results for "${trimmed}"`);
    return null;
  }

  console.log(`[Algolia] ${hits.length} results for "${trimmed}"`);

  // Diagnostic log for first hit
  if (hits.length > 0) {
    const h = hits[0];
    console.log(`[AlgoliaDiag] title="${h.title}" sku="${h.sku}" handle="${h.handle}"`);
    console.log(`[AlgoliaDiag] product_image="${h.product_image?.substring(0, 80)}"`);
    console.log(`[AlgoliaDiag] price=${h.price} variants_min_price=${h.variants_min_price}`);
    console.log(`[AlgoliaDiag] has variants=${Array.isArray(h.variants) ? h.variants.length : 'none'}`);
    console.log(`[AlgoliaDiag] objectID=${h.objectID} id=${h.id}`);
  }

  const handles = hits.map((h) => h.handle).filter(Boolean);
  const variantMap = await fetchVariantIdsByHandles(handles, shopDomain);

  const STOREFRONT_HOST = 'www.creativeautomation.ae';

  const products = hits.map((hit) => {
    const rawId = hit.objectID || hit.id || '';
    const productId = String(rawId).startsWith('gid://')
      ? rawId
      : `gid://shopify/Product/${rawId}`;

    // IMAGE (v3.1 FIX): Reject literal string "undefined" or "null" in addition to
    // falsy values. Some Algolia records have product_image = "undefined" (string).
    const imageUrl =
      (isValidImageUrl(hit.product_image) ? hit.product_image : null) ||
      (hit.image && typeof hit.image === 'object' && isValidImageUrl(hit.image.src)
        ? hit.image.src : null) ||
      (isValidImageUrl(hit.image) ? hit.image : null) ||
      (isValidImageUrl(hit.featured_image) ? hit.featured_image : null) ||
      (Array.isArray(hit.images) && isValidImageUrl(hit.images[0]) ? hit.images[0] : null) ||
      null;

    // PRICE: integer in AED (e.g. 4437), NOT cents
    const rawPrice = hit.variants_min_price ?? hit.price ?? null;
    const currency = hit.currency_code || 'AED';
    const price = rawPrice != null
      ? `${parseFloat(String(rawPrice)).toFixed(2)} ${currency}`
      : null;

    // VARIANT ID: from Storefront lookup
    const variantInfo = hit.handle ? variantMap.get(hit.handle) : null;
    const variantId = variantInfo?.variantId || null;
    const variantSku = variantInfo?.variantSku || hit.sku || null;

    // DESCRIPTION
    const rawDesc = hit.body_html_safe || hit.body_html || '';
    const description = typeof rawDesc === 'string'
      ? rawDesc.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 500)
      : '';

    const result = {
      id: productId,
      title: hit.title || 'Untitled Product',
      handle: hit.handle || null,
      vendor: hit.vendor || null,
      image_url: imageUrl,
      url: hit.handle
        ? `https://${STOREFRONT_HOST}/products/${hit.handle}`
        : null,
      price,
      description,
      variant_id: variantId,
      merchandise_id: variantId,
      sku: variantSku,
    };

    if (!imageUrl) {
      console.warn(`[Algolia] No image for "${hit.title}" — product_image=${hit.product_image}`);
    }
    if (!variantId) {
      console.warn(`[Algolia] No variant_id for "${hit.title}" handle="${hit.handle}"`);
    }

    return result;
  });

  return { products };
}
