/**
 * Shopify Storefront API GraphQL Queries & Mutations
 * All queries and mutations for product search, cart, and checkout
 */

// ============================================
// SEARCH PRODUCTS
// ============================================
export const SEARCH_PRODUCTS_QUERY = `
  query searchProducts($query: String!, $first: Int) {
    products(first: $first, query: $query) {
      edges {
        node {
          id
          title
          handle
          description
          featuredImage {
            url
            altText
          }
          images(first: 3) {
            edges {
              node {
                url
              }
            }
          }
          priceRange {
            minVariantPrice {
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

// ============================================
// GET PRODUCT BY HANDLE (for View button)
// ============================================
export const GET_PRODUCT_BY_HANDLE_QUERY = `
  query getProductByHandle($handle: String!) {
    productByHandle(handle: $handle) {
      id
      title
      handle
      description
      featuredImage {
        url
        altText
      }
      images(first: 10) {
        edges {
          node {
            url
          }
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
`;

// ============================================
// CREATE CART (Add to Cart - New Cart)
// ============================================
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
        cost {
          totalAmount {
            amount
            currencyCode
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

// ============================================
// ADD LINES TO EXISTING CART
// ============================================
export const ADD_LINES_TO_CART_MUTATION = `
  mutation addLinesToCart($cartId: ID!, $lines: [CartLineInput!]!) {
    cartLinesAdd(cartId: $cartId, lines: $lines) {
      cart {
        id
        checkoutUrl
        totalQuantity
        cost {
          totalAmount {
            amount
            currencyCode
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

// ============================================
// GET CART (View Cart)
// ============================================
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
