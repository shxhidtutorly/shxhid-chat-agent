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

    // DIAGNOSTIC: Log first hit's exact field shapes so we can fix image/variant mapping
    if (hits.length > 0) {
      const h = hits[0];
      console.log(`[AlgoliaDiag] objectID=${h.objectID} title="${h.title}"`);
      console.log(`[AlgoliaDiag] image type=${typeof h.image} value=${JSON.stringify(h.image)?.substring(0, 200)}`);
      console.log(`[AlgoliaDiag] featured_image type=${typeof h.featured_image} value=${JSON.stringify(h.featured_image)?.substring(0, 200)}`);
      console.log(`[AlgoliaDiag] images=${JSON.stringify(h.images)?.substring(0, 200)}`);
      console.log(`[AlgoliaDiag] variants[0]=${JSON.stringify(h.variants?.[0])?.substring(0, 200)}`);
      console.log(`[AlgoliaDiag] price=${h.price} price_min=${h.price_min} currency_code=${h.currency_code}`);
    }

    const products = hits.map(hit => {
      const rawId = hit.objectID || hit.id || '';
      const productId = rawId.includes('gid://')
        ? rawId
        : `gid://shopify/Product/${rawId}`;

      const firstVariant = Array.isArray(hit.variants) && hit.variants.length > 0
        ? hit.variants[0]
        : null;

      // Algolia stores variant IDs as plain numbers (e.g. 44823571415113)
      // The cart API requires GID format: gid://shopify/ProductVariant/44823571415113
      const rawVariantId = firstVariant?.id ?? firstVariant?.variant_id ?? null;
      const variantId = rawVariantId != null
        ? (String(rawVariantId).startsWith('gid://')
            ? String(rawVariantId)
            : `gid://shopify/ProductVariant/${rawVariantId}`)
        : null;

      const variantSku = firstVariant?.sku
        || firstVariant?.product_sku
        || hit.sku
        || null;

      // Algolia Shopify integration price shapes:
      // price_min: 150.00 (float, already in currency units)
      // price: 150.00 or "150.00"
      // variants[0].price: "150.00"
      const rawPrice = hit.price_min ?? hit.price ?? firstVariant?.price ?? null;
      const currency = hit.currency_code || hit.price_currency || 'AED';
      const price = rawPrice != null && rawPrice !== ''
        ? `${parseFloat(String(rawPrice).replace(/[^0-9.]/g, '')).toFixed(2)} ${currency}`
        : null;

      // Algolia Shopify integration image field shapes:
      // - hit.image = { src: "https://..." }  (most common)
      // - hit.image = "https://..."           (string form)
      // - hit.featured_image = "https://..."  (string)
      // - hit.images = ["https://...", ...]   (array of strings)
      // - hit.images = [{ src: "https://..." }] (array of objects)
      const imageUrl =
        // hit.image object with src
        (hit.image && typeof hit.image === 'object' && typeof hit.image.src === 'string' && hit.image.src.startsWith('http')
          ? hit.image.src : null) ||
        // hit.image as string
        (typeof hit.image === 'string' && hit.image.startsWith('http')
          ? hit.image : null) ||
        // featured_image as string (most common in Algolia Shopify integration)
        (typeof hit.featured_image === 'string' && hit.featured_image.startsWith('http')
          ? hit.featured_image : null) ||
        // featured_image as object
        (hit.featured_image && typeof hit.featured_image === 'object'
          ? hit.featured_image?.url || hit.featured_image?.src : null) ||
        // images array — string items
        (typeof hit.images?.[0] === 'string' && hit.images[0].startsWith('http')
          ? hit.images[0] : null) ||
        // images array — object items
        (hit.images?.[0] && typeof hit.images[0] === 'object'
          ? hit.images[0]?.src || hit.images[0]?.url : null) ||
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
        sku: variantSku,
      };
    });

    return { products };
  } catch (err) {
    console.error(`[Algolia] Search failed: ${err.message}`);
    return null;
  }
}
