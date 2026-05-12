/**
 * Algolia Search Service — v1.0
 * Primary text search layer for 200k+ product catalog.
 * SKU exact lookups still use Admin API (admin-products.server.js).
 * Storefront search is the fallback when Algolia is not configured.
 */

let _client = null;

async function getClient() {
  if (_client) return _client;
  const appId = process.env.ALGOLIA_APP_ID;
  const apiKey = process.env.ALGOLIA_SEARCH_KEY;
  if (!appId || !apiKey) {
    throw new Error('[Algolia] ALGOLIA_APP_ID and ALGOLIA_SEARCH_KEY must be set');
  }
  // algoliasearch package — correct server-side client
  // Try multiple import styles to handle different package versions
  let algoliasearch;
  try {
    const mod = await import('algoliasearch');
    algoliasearch = mod.default || mod.algoliasearch || mod;
    if (typeof algoliasearch !== 'function') {
      throw new Error('algoliasearch is not a function after import');
    }
  } catch (importErr) {
    throw new Error(`[Algolia] Failed to import algoliasearch: ${importErr.message}. Run: npm install algoliasearch`);
  }
  _client = algoliasearch(appId, apiKey);
  return _client;
}

export function isAlgoliaConfigured() {
  return !!(process.env.ALGOLIA_APP_ID && process.env.ALGOLIA_SEARCH_KEY);
}

export async function algoliaSearch(query, { first = 20 } = {}) {
  if (!query || typeof query !== 'string') return null;
  const trimmed = query.trim();
  if (!trimmed) return null;

  const indexName = process.env.ALGOLIA_INDEX_NAME || 'shopify_products';
  console.log(`[Algolia] Searching: "${trimmed}" in "${indexName}"`);

  try {
    const client = await getClient();

    let hits = [];
    try {
      // algoliasearch v5 style
      const response = await client.search({
        requests: [{
          indexName,
          query: trimmed,
          hitsPerPage: first,
          attributesToRetrieve: [
            'id', 'objectID', 'title', 'handle', 'vendor',
            'product_type', 'tags', 'body_html',
            'price', 'price_min', 'price_max', 'currency_code',
            'image', 'featured_image', 'images',
            'variants', 'sku'
          ],
        }]
      });
      hits = response.results?.[0]?.hits || [];
    } catch (v5Err) {
      // algoliasearch v4 style fallback
      try {
        const index = client.initIndex(indexName);
        const response = await index.search(trimmed, {
          hitsPerPage: first,
          attributesToRetrieve: [
            'id', 'objectID', 'title', 'handle', 'vendor',
            'product_type', 'tags', 'body_html',
            'price', 'price_min', 'price_max', 'currency_code',
            'image', 'featured_image', 'images',
            'variants', 'sku'
          ],
        });
        hits = response.hits || [];
      } catch (v4Err) {
        throw new Error(`Algolia search failed (v5: ${v5Err.message}, v4: ${v4Err.message})`);
      }
    }

    if (hits.length === 0) {
      console.log(`[Algolia] 0 results for "${trimmed}"`);
      return null;
    }
    console.log(`[Algolia] ${hits.length} results for "${trimmed}"`);

    const products = hits.map(hit => {
      const rawId = hit.objectID || hit.id || '';
      const productId = rawId.includes('gid://')
        ? rawId
        : `gid://shopify/Product/${rawId}`;

      const firstVariant = hit.variants?.[0];
      const rawVariantId = firstVariant?.id;
      const variantId = rawVariantId
        ? (String(rawVariantId).includes('gid://')
            ? String(rawVariantId)
            : `gid://shopify/ProductVariant/${rawVariantId}`)
        : null;

      const priceNum = hit.price_min ?? hit.price ?? null;
      const currency = hit.currency_code || 'AED';
      const price = priceNum != null
        ? `${parseFloat(priceNum).toFixed(2)} ${currency}`
        : null;

      // Algolia Shopify integration stores images in multiple shapes
      const imageUrl =
        hit.image?.src ||
        hit.image?.url ||
        (typeof hit.featured_image === 'string' ? hit.featured_image : null) ||
        hit.featured_image?.url ||
        hit.images?.[0]?.src ||
        hit.images?.[0] ||
        null;

      const description = typeof hit.body_html === 'string'
        ? hit.body_html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 500)
        : '';

      return {
        id: productId,
        title: hit.title || 'Untitled Product',
        handle: hit.handle || null,
        vendor: hit.vendor || null,
        image_url: imageUrl,
        url: hit.handle
          ? `https://www.creativeautomation.ae/products/${hit.handle}`
          : null,
        price,
        description,
        variant_id: variantId,
        merchandise_id: variantId,
        sku: hit.sku || firstVariant?.sku || null,
      };
    });

    return { products };
  } catch (err) {
    console.error(`[Algolia] Search failed: ${err.message}`);
    return null;
  }
}
