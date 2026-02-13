/**
 * Shopify Storefront API GraphQL Queries & Mutations
 * ✅ FIXED: Uses cartCheckoutUrl (not checkoutUrl)
 */

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

// ✅ FIXED: Uses cartCheckoutUrl instead of checkoutUrl
export const CREATE_CART_MUTATION = `
  mutation createCart($lines: [CartLineInput!]!) {
    cartCreate(input: { lines: $lines }) {
      cart {
        id
        checkoutUrl: cartCheckoutUrl
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

// ✅ FIXED: Uses cartCheckoutUrl instead of checkoutUrl
export const ADD_LINES_TO_CART_MUTATION = `
  mutation addLinesToCart($cartId: ID!, $lines: [CartLineInput!]!) {
    cartLinesAdd(cartId: $cartId, lines: $lines) {
      cart {
        id
        checkoutUrl: cartCheckoutUrl
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
      checkoutUrl: cartCheckoutUrl
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
