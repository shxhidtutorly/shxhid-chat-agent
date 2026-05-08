/**
 * Admin Products / Variants Search
 *
 * Thin wrapper over the existing shopifyAdminGraphqlQuery (which uses
 * the OAuth session.accessToken from Prisma). Used by the search router
 * to do reliable vendor- and SKU-filtered queries that the Storefront
 * search can't do without Search & Discovery vendor filters.
 *
 * Required scope: read_products (added to shopify.app.toml).
 */

import { shopifyAdminGraphqlQuery } from "../shopify-storefront.js";

const PRODUCTS_BY_VENDOR_QUERY = `
  query productsByVendor($vendorQuery: String!, $first: Int!) {
    products(first: $first, query: $vendorQuery) {
      nodes {
        id
        title
        handle
        vendor
        productType
        tags
        descriptionHtml
        variants(first: 5) {
          nodes {
            id
            title
            sku
            price
            inventoryQuantity
          }
        }
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
`;

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

function escapeQueryValue(s) {
  return String(s).replace(/"/g, '\\"');
}

export async function searchProductsByVendor(shopDomain, vendor, categoryTerms = "") {
  const vendorEsc = escapeQueryValue(vendor);
  let vendorQuery = `vendor:"${vendorEsc}"`;
  if (categoryTerms && categoryTerms.trim()) {
    // Tokenize category terms — Admin API supports unquoted token search on
    // title and product_type. Keep it simple: just AND the raw terms.
    const terms = categoryTerms.trim().replace(/"/g, "");
    vendorQuery = `vendor:"${vendorEsc}" AND (title:${terms} OR product_type:${terms})`;
  }

  console.log(`[AdminProducts] vendor query: ${vendorQuery}`);

  try {
    const data = await shopifyAdminGraphqlQuery({
      query: PRODUCTS_BY_VENDOR_QUERY,
      variables: { vendorQuery, first: 20 },
      shopDomain,
    });
    const products = data?.products?.nodes || [];
    console.log(`[AdminProducts] vendor="${vendor}" returned ${products.length} products`);
    return products;
  } catch (err) {
    console.error(`[AdminProducts] vendor search failed: ${err.message}`);
    return null;
  }
}

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
