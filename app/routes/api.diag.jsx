/**
 * Diagnostic endpoint — bypasses MCP, calls Storefront/Admin directly.
 *
 * Auth: requires ?token=<DIAG_TOKEN env> to prevent public abuse.
 *
 * Examples:
 *   GET /api/diag?token=...&q=ABB
 *   GET /api/diag?token=...&sku=E12584
 *
 * Returns the first 3 raw products (or variants for sku=) as JSON so we can
 * inspect actual field shapes (vendor, productType, tags, featuredImage,
 * variants[].sku) without grepping Railway logs.
 */
export async function loader({ request }) {
  const url = new URL(request.url);
  const token = url.searchParams.get('token') || '';
  const expected = process.env.DIAG_TOKEN || '';

  if (!expected) {
    return jsonResponse({ error: 'DIAG_TOKEN not configured on server' }, 503);
  }
  if (token !== expected) {
    return jsonResponse({ error: 'unauthorized' }, 401);
  }

  const q = url.searchParams.get('q');
  const sku = url.searchParams.get('sku');
  const shopDomain = url.searchParams.get('shop') || process.env.SHOPIFY_STORE_DOMAIN || null;

  try {
    const mod = await import('../storefront-service.js');

    if (sku) {
      const wrapped = await mod.searchVariantBySku(sku, { first: 5, shopDomain });
      const parsed = JSON.parse(wrapped.content[0].text);
      return jsonResponse({
        mode: 'sku',
        sku,
        shopDomain,
        product_count: parsed.products?.length || 0,
        products: (parsed.products || []).slice(0, 3),
      });
    }

    if (q) {
      const wrapped = await mod.searchProductsForChat(q, { first: 5, shopDomain });
      const parsed = JSON.parse(wrapped.content[0].text);
      return jsonResponse({
        mode: 'search',
        query: q,
        shopDomain,
        product_count: parsed.products?.length || 0,
        products: (parsed.products || []).slice(0, 3),
      });
    }

    return jsonResponse({
      error: 'missing query',
      usage: 'GET /api/diag?token=...&q=ABB  or  &sku=E12584',
    }, 400);
  } catch (err) {
    console.error('[Diag] error:', err.message);
    return jsonResponse({ error: err.message }, 500);
  }
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    },
  });
}
