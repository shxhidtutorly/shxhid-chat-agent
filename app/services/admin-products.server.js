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

export async function searchBySku(shopDomain, sku) {
  const skuTrim = String(sku).trim();
  console.log(`[AdminProducts] SKU search: sku:${skuTrim}`);

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
