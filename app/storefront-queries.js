/**
 * Shopify Storefront API GraphQL Queries & Mutations
 *
 * PATCH v3.0 — April 2026
 *
 * KEY CHANGE: Added STOREFRONT_SEARCH_QUERY using the `search` field.
 *
 * WHY: The existing SEARCH_PRODUCTS_QUERY uses `products(query:)` which
 * does NOT index variant.sku. This means SKU searches silently fail.
 * The Shopify `search` query indexes:
 *   - title, body_html, vendor, product_type, tags
 *   - variants.title, variants.sku  ← this is what we need
 * Source: https://shopify.dev/docs/api/storefront/latest/queries/search
 *
 * `prefix: LAST` enables partial word matching on the last token, so
 * "MGPM12" matches "MGPM12-10Z" — critical for partial-SKU lookups.
 *
 * The SEARCH_PRODUCTS_QUERY (products field) is kept for addToCart
 * operations in api.cart.jsx which don't need SKU indexing.
 */

// ─────────────────────────────────────────────────────────────
// PLAIN-TEXT STOREFRONT SEARCH — v5.0
//
// No productFilters. No vendor: prefixes. Just raw user text.
// Storefront `search` indexes title, description, vendor, productType,
// tags, and variant.sku — so "IFM sensor" returns IFM sensor products
// ranked by Shopify's relevance engine.
// `prefix: LAST` enables partial word matching on the trailing token.
// Docs: https://shopify.dev/docs/api/storefront/latest/queries/search
// ─────────────────────────────────────────────────────────────
export const STOREFRONT_PLAIN_SEARCH_QUERY = `
  query StorefrontPlainSearch($query: String!, $first: Int!) {
    search(query: $query, types: PRODUCT, first: $first, prefix: LAST) {
      totalCount
      nodes {
        ... on Product {
          id
          title
          handle
          description
          vendor
          productType
          tags
          featuredImage {
            url
            altText
          }
          priceRange {
            minVariantPrice { amount currencyCode }
            maxVariantPrice { amount currencyCode }
          }
          variants(first: 10) {
            edges {
              node {
                id
                title
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

// ─────────────────────────────────────────────────────────────
// LEGACY: Used by /api/diag and api.cart.jsx fallbacks.
// Kept for backwards compat — chat search now uses STOREFRONT_PLAIN_SEARCH_QUERY.
// ─────────────────────────────────────────────────────────────
export const STOREFRONT_SEARCH_QUERY = `
  query storefrontSearch($query: String!, $first: Int) {
    search(query: $query, first: $first, types: PRODUCT, prefix: LAST) {
      edges {
        node {
          ... on Product {
            id
            title
            handle
            description
            vendor
            productType
            tags
            featuredImage {
              url
              altText
            }
            priceRange {
              minVariantPrice {
                amount
                currencyCode
              }
              maxVariantPrice {
                amount
                currencyCode
              }
            }
            variants(first: 10) {
              edges {
                node {
                  id
                  title
                  sku
                  availableForSale
                  price {
                    amount
                    currencyCode
                  }
                }
              }
            }
          }
        }
      }
    }
  }
`;

// ─────────────────────────────────────────────────────────────
// SECONDARY: Keep for api.cart.jsx add-to-cart operations
// Uses products(query:) — fine for handle/title lookups
// ─────────────────────────────────────────────────────────────
export const SEARCH_PRODUCTS_QUERY = `
  query searchProducts($query: String!, $first: Int) {
    products(first: $first, query: $query) {
      edges {
        node {
          id
          title
          handle
          description
          vendor
          productType
          tags
          featuredImage {
            url
            altText
          }
          priceRange {
            minVariantPrice {
              amount
              currencyCode
            }
            maxVariantPrice {
              amount
              currencyCode
            }
          }
          variants(first: 5) {
            edges {
              node {
                id
                title
                sku
                availableForSale
                price {
                  amount
                  currencyCode
                }
              }
            }
          }
        }
      }
    }
  }
`;

// ─────────────────────────────────────────────────────────────
// ADMIN API — variant lookup by SKU
//
// Storefront `search` indexes variant.sku but with relevance ranking, not
// strict equality. For exact-SKU lookups (e.g. "E12584") we use the Admin
// API's productVariants(query: "sku:VALUE") which targets sku as a field.
//
// Caveat: the productVariants(query:) sku predicate has a known
// substring-matching quirk — "sku:E125" can match "E12584". Callers must
// post-filter for exact equality.
// ─────────────────────────────────────────────────────────────
export const SEARCH_VARIANT_BY_SKU_QUERY = `
  query searchVariantBySku($query: String!, $first: Int) {
    productVariants(first: $first, query: $query) {
      edges {
        node {
          id
          title
          sku
          availableForSale
          price
          product {
            id
            title
            handle
            description
            vendor
            productType
            tags
            featuredImage {
              url
              altText
            }
            priceRange {
              minVariantPrice {
                amount
                currencyCode
              }
              maxVariantPrice {
                amount
                currencyCode
              }
            }
          }
        }
      }
    }
  }
`;

export const CREATE_CART_MUTATION = `
  mutation createCart($lines: [CartLineInput!]!) {
    cartCreate(input: { lines: $lines }) {
      cart {
        id
        checkoutUrl
        totalQuantity
        lines(first: 10) {
          edges {
            node {
              id
              quantity
              merchandise {
                ... on ProductVariant {
                  id
                  title
                  product {
                    title
                    handle
                  }
                }
              }
            }
          }
        }
      }
      userErrors {
        field
        message
      }
    }
  }
`;

export const ADD_LINES_TO_CART_MUTATION = `
  mutation addLinesToCart($cartId: ID!, $lines: [CartLineInput!]!) {
    cartLinesAdd(cartId: $cartId, lines: $lines) {
      cart {
        id
        checkoutUrl
        totalQuantity
      }
      userErrors {
        field
        message
      }
    }
  }
`;

export const GET_CART_QUERY = `
  query getCart($cartId: ID!) {
    cart(id: $cartId) {
      id
      checkoutUrl
      totalQuantity
      lines(first: 10) {
        edges {
          node {
            id
            quantity
            merchandise {
              ... on ProductVariant {
                id
                title
              }
            }
          }
        }
      }
      cost {
        totalAmount {
          amount
          currencyCode
        }
      }
    }
  }
`;
