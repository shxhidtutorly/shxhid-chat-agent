/**
 * Admin Products / Variants Search — v5.0 (simplified)
 *
 * Only two functions remain:
 *   - searchBySku()    — exact SKU lookup via Admin productVariants(query: "sku:...")
 *   - getAllVendors()  — diagnostics helper
 *
 * Vendor-targeted product search has been removed; the new flow uses Storefront
 * `search` (plain text) for everything that isn't a SKU.
 *
 * Required scope: read_products.
 */

import { shopifyAdminGraphqlQuery } from "../shopify-storefront.js";

const SKU_SEARCH_QUERY = `
  query skuSearch($skuQuery: String!, $first: Int!) {
    productVariants(first: $first, query: $skuQuery) {
      nodes {
        id
        sku
        title
        price
        inventoryQuantity
        product {
          id
          title
          handle
          vendor
          tags
          descriptionHtml
          featuredMedia {
            preview { image { url altText } }
          }
          images(first: 3) {
            nodes { url altText }
          }
          priceRangeV2 {
            minVariantPrice { amount currencyCode }
            maxVariantPrice { amount currencyCode }
          }
        }
      }
    }
  }
`;

const ALL_VENDORS_QUERY = `
  query allVendors {
    products(first: 250, query: "status:active") {
      nodes { vendor }
    }
  }
`;

// B2 fix: Admin GraphQL exposes the full distinct-vendor list directly.
// Docs: https://shopify.dev/docs/api/admin-graphql/latest/queries/productVendors
// (paginated StringConnection, max 1000 per page, requires read_products).
// Used as the source of truth when Algolia's searchForFacetValues is capped
// at 100 facet hits (its API maximum) or fails (e.g. `vendor` declared
// filterOnly, which searchForFacetValues cannot query).
const PRODUCT_VENDORS_QUERY = `
  query productVendors($first: Int!, $after: String) {
    productVendors(first: $first, after: $after) {
      nodes
      pageInfo { hasNextPage endCursor }
    }
  }
`;

/**
 * Fetch ALL distinct product vendors for the shop via `productVendors`.
 * Paginated; capped at maxPages * 1000 vendors as a runaway guard.
 * Returns string[] (may be empty), or throws on API failure.
 */
export async function getAllProductVendors(shopDomain, { maxPages = 5 } = {}) {
  const vendors = [];
  let after = null;
  for (let page = 0; page < maxPages; page++) {
    const data = await shopifyAdminGraphqlQuery({
      query: PRODUCT_VENDORS_QUERY,
      variables: { first: 1000, after },
      shopDomain,
    });
    const conn = data?.productVendors;
    vendors.push(...(conn?.nodes || []).filter((v) => typeof v === "string" && v.trim()));
    if (!conn?.pageInfo?.hasNextPage) break;
    after = conn.pageInfo.endCursor;
  }
  console.log(`[AdminProducts] productVendors: ${vendors.length} distinct vendors`);
  return vendors;
}

const ADMIN_TEXT_SEARCH_QUERY = `
  query adminTextSearch($q: String!, $first: Int!) {
    products(first: $first, query: $q) {
      nodes {
        id
        title
        handle
        vendor
        productType
        tags
        descriptionHtml
        featuredMedia { preview { image { url altText } } }
        images(first: 1) { nodes { url altText } }
        priceRangeV2 {
          minVariantPrice { amount currencyCode }
          maxVariantPrice { amount currencyCode }
        }
        variants(first: 1) {
          nodes { id sku availableForSale price }
        }
      }
    }
  }
`;

// opts.exactOnly (B4 probe): skip the partial/wildcard fallbacks and return
// only case-insensitive exact SKU matches — used by the router's always-on
// exact-SKU probe where near-matches would be noise.
export async function searchBySku(shopDomain, sku, { exactOnly = false } = {}) {
  const skuTrim = String(sku).trim();
  console.log(`[AdminProducts] SKU search: sku:${skuTrim}${exactOnly ? ' (exact-only)' : ''}`);

  try {
    let data = await shopifyAdminGraphqlQuery({
      query: SKU_SEARCH_QUERY,
      variables: { skuQuery: `sku:${skuTrim}`, first: 10 },
      shopDomain,
    });

    let variants = data?.productVariants?.nodes || [];

    const skuUpper = skuTrim.toUpperCase();
    const exact = variants.filter((v) => v.sku && v.sku.toUpperCase() === skuUpper);
    if (exact.length > 0) {
      console.log(`[AdminProducts] exact SKU match: ${exact.length} variants`);
      return { type: "exact", variants: exact, originalSku: skuTrim };
    }
    if (exactOnly) {
      return { type: "none", variants: [], originalSku: skuTrim };
    }
    if (variants.length > 0) {
      console.log(`[AdminProducts] partial SKU matches: ${variants.length} variants`);
      return { type: "partial", variants, originalSku: skuTrim };
    }

    // Wildcard prefix fallback
    const prefix = skuTrim.replace(/[A-Z0-9]{1,3}$/i, "");
    if (prefix && prefix !== skuTrim && prefix.length >= 3) {
      data = await shopifyAdminGraphqlQuery({
        query: SKU_SEARCH_QUERY,
        variables: { skuQuery: `sku:${prefix}*`, first: 10 },
        shopDomain,
      });
      variants = data?.productVariants?.nodes || [];
      if (variants.length > 0) {
        console.log(`[AdminProducts] wildcard SKU matches for "${prefix}*": ${variants.length}`);
        return { type: "wildcard", variants, originalSku: skuTrim, prefix };
      }
    }

    console.log(`[AdminProducts] no SKU matches for "${skuTrim}"`);
    return { type: "none", variants: [], originalSku: skuTrim };
  } catch (err) {
    console.error(`[AdminProducts] SKU search failed: ${err.message}`);
    return null;
  }
}

/**
 * Tier-2 text search via Admin GraphQL `products(query: ...)`.
 * Uses Shopify's saved-search syntax (title:* / vendor:*), which is more
 * precise than Storefront `search` (broad full-text). Returns the same
 * shape the Storefront result mapper consumes, so the router can pass
 * the products through storefrontProductToCardShape unchanged.
 *
 * Docs: https://shopify.dev/docs/api/usage/search-syntax
 */
// Tokens shorter than this are noise in 200k-row substring searches.
const MIN_ADMIN_TOKEN_LEN = 3;
// Cap to avoid Shopify rejecting a giant query string.
const MAX_ADMIN_TOKENS = 5;

function _adminTokenize(s) {
  return String(s)
    .toLowerCase()
    .replace(/[^a-z0-9\-]/g, ' ')
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= MIN_ADMIN_TOKEN_LEN)
    .slice(0, MAX_ADMIN_TOKENS);
}

async function _runAdminSearch(searchQuery, shopDomain) {
  console.log(`[AdminProducts] text search: "${searchQuery}"`);
  const data = await shopifyAdminGraphqlQuery({
    query: ADMIN_TEXT_SEARCH_QUERY,
    variables: { q: searchQuery, first: 10 },
    shopDomain,
  });
  const nodes = data?.products?.nodes || [];
  console.log(`[AdminProducts] text search returned ${nodes.length} products`);
  return nodes;
}

/**
 * B3 fix: Shopify search syntax supports PREFIX wildcards only ("norm*"
 * matches "norman"); a leading `*` (`title:*token*`) is not part of the
 * documented syntax and gave unreliable recall on this fallback tier.
 * Verified against https://shopify.dev/docs/api/usage/search-syntax
 * (2026-07-08). Queries now use `token*` prefix form, and the broadening
 * pass searches vendor/product_type/sku explicitly instead of title-only.
 * Rollback: restore the previous `title:*t*` clauses.
 */
export function buildAdminSearchQueries(trimmed, tokens) {
  if (tokens.length === 0) {
    return [`title:${trimmed}* OR vendor:${trimmed}*`];
  }
  const pass1 = tokens.map((t) => `title:${t}*`).join(" AND ");
  const t = tokens[0];
  const pass2 = `title:${t}* OR vendor:${t}* OR product_type:${t}* OR sku:${t}*`;
  return [pass1, pass2];
}

export async function adminTextSearch(query, shopDomain) {
  if (!query || typeof query !== "string") return null;
  const trimmed = query.trim();
  if (!trimmed) return null;

  // Pass 1: token-AND prefix search on title. Pass 2 (zero hits): first token
  // broadened across title/vendor/product_type/sku.
  const tokens = _adminTokenize(trimmed);
  const passes = buildAdminSearchQueries(trimmed, tokens);
  let nodes = [];
  try {
    for (const q of passes) {
      nodes = await _runAdminSearch(q, shopDomain);
      if (nodes.length > 0) break;
    }
    if (nodes.length === 0) return null;

    const products = nodes.map((p) => ({
      id: p.id,
      title: p.title,
      handle: p.handle,
      vendor: p.vendor,
      product_type: p.productType,
      tags: p.tags,
      description: (p.descriptionHtml || "")
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 500),
      image_url:
        p.featuredMedia?.preview?.image?.url ||
        p.images?.nodes?.[0]?.url ||
        null,
      featuredImage:
        p.featuredMedia?.preview?.image || p.images?.nodes?.[0] || null,
      priceRange: p.priceRangeV2,
      variants: (p.variants?.nodes || []).map((v) => ({
        id: v.id,
        sku: v.sku,
        available: v.availableForSale,
        price: v.price,
      })),
      sku: p.variants?.nodes?.[0]?.sku || null,
    }));

    return { products };
  } catch (err) {
    console.warn(`[AdminProducts] text search failed: ${err.message}`);
    return null;
  }
}

export async function getAllVendors(shopDomain) {
  try {
    const data = await shopifyAdminGraphqlQuery({
      query: ALL_VENDORS_QUERY,
      variables: {},
      shopDomain,
    });
    const vendors = [
      ...new Set((data?.products?.nodes || []).map((p) => p.vendor).filter(Boolean)),
    ];
    console.log(`[AdminProducts] found ${vendors.length} unique vendors`);
    return vendors;
  } catch (err) {
    console.error(`[AdminProducts] getAllVendors failed: ${err.message}`);
    return [];
  }
}
