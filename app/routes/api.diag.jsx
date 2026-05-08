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
  const mode = url.searchParams.get('mode');
  const vendorParam = url.searchParams.get('vendor');
  const shopDomain = url.searchParams.get('shop') || process.env.SHOPIFY_STORE_DOMAIN || null;

  try {
    const mod = await import('../storefront-service.js');
    const sf = await import('../shopify-storefront.js');

    // mode=vendors → list all unique vendors via Admin API.
    // Paginates up to 5 pages of 250 to cover catalogs up to 1250 products.
    if (mode === 'vendors') {
      const VENDORS_QUERY = `
        query Vendors($cursor: String) {
          products(first: 250, after: $cursor, query: "status:active") {
            nodes { vendor }
            pageInfo { hasNextPage endCursor }
          }
        }
      `;
      const seen = new Map();
      let cursor = null;
      let pages = 0;
      while (pages < 5) {
        const data = await sf.shopifyAdminGraphqlQuery({
          query: VENDORS_QUERY,
          variables: { cursor },
          shopDomain,
        });
        const nodes = data?.products?.nodes || [];
        for (const n of nodes) {
          const v = (n.vendor || '').trim();
          if (!v) continue;
          seen.set(v, (seen.get(v) || 0) + 1);
        }
        pages += 1;
        if (!data?.products?.pageInfo?.hasNextPage) break;
        cursor = data.products.pageInfo.endCursor;
      }
      const vendors = [...seen.entries()]
        .map(([vendor, count]) => ({ vendor, count }))
        .sort((a, b) => b.count - a.count);
      return jsonResponse({ mode: 'vendors', shopDomain, pages, total_vendors: vendors.length, vendors });
    }

    // mode=vendortest → does the productVendor filter work on Storefront search?
    // Needs ?vendor=Abb and optional ?q=circuit%20breaker
    if (mode === 'vendortest') {
      if (!vendorParam) {
        return jsonResponse({ error: 'missing vendor param', usage: 'mode=vendortest&vendor=Abb&q=circuit%20breaker' }, 400);
      }
      const queryString = q || vendorParam;
      const variants = [
        vendorParam,
        vendorParam.charAt(0).toUpperCase() + vendorParam.slice(1).toLowerCase(),
        vendorParam.toUpperCase(),
        vendorParam.toLowerCase(),
      ];
      const unique = [...new Set(variants)];
      const results = [];
      for (const v of unique) {
        try {
          const wrapped = await mod.searchByVendor(v, q || '', { first: 5, shopDomain });
          if (wrapped) {
            const parsed = JSON.parse(wrapped.content[0].text);
            results.push({ vendor_variant: v, total_returned: parsed.products?.length || 0, sample: (parsed.products || []).slice(0, 2).map((p) => ({ title: p.title, vendor: p.vendor })) });
          } else {
            results.push({ vendor_variant: v, total_returned: 0, note: 'returned null (filter may be disabled or no matches)' });
          }
        } catch (err) {
          results.push({ vendor_variant: v, error: err.message });
        }
      }
      return jsonResponse({ mode: 'vendortest', shopDomain, query: queryString, results });
    }

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
      usage: [
        'GET /api/diag?token=...&q=ABB',
        'GET /api/diag?token=...&sku=E12584',
        'GET /api/diag?token=...&mode=vendors',
        'GET /api/diag?token=...&mode=vendortest&vendor=Abb&q=circuit%20breaker',
      ],
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
