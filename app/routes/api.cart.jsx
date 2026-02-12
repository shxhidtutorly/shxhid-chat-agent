/**
 * Cart API Endpoint
 * Integrates Storefront API for cart operations
 */

import { addToCart } from '../storefront-service.js';

export function loader({ request }) {
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: getCorsHeaders(request),
    });
  }
  return new Response('Cart API Ready', { headers: getCorsHeaders(request) });
}

export async function action({ request }) {
  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: getCorsHeaders(request) });
  }

  if (request.method !== 'POST') {
    return new Response('Method not allowed', { 
      status: 405, 
      headers: getCorsHeaders(request) 
    });
  }

  try {
    const body = await request.json();
    const { variantId, quantity = 1, cartId } = body;

    console.log(`\n${'='.repeat(60)}`);
    console.log(`🛒 CART API REQUEST`);
    console.log(`${'='.repeat(60)}`);
    console.log(`  Variant: ${variantId?.substring(0, 50)}`);
    console.log(`  Quantity: ${quantity}`);
    console.log(`  Cart: ${cartId ? 'existing' : 'new'}`);

    if (!variantId) {
      return Response.json(
        { status: 'error', message: 'variantId is required' },
        { status: 400, headers: getCorsHeaders(request) }
      );
    }

    // ✅ Call Storefront Service
    const result = await addToCart({
      variantId,
      quantity,
      cartId: cartId || null
    });

    console.log(`✅ SUCCESS`);
    console.log(`  CartId: ${result.cartId?.substring(0, 30)}...`);
    console.log(`  Checkout: ${result.checkoutUrl?.substring(0, 50)}...`);
    console.log(`${'='.repeat(60)}\n`);

    return Response.json({
      status: 'success',
      cartId: result.cartId,
      checkoutUrl: result.checkoutUrl,
      totalQuantity: result.totalQuantity
    }, { 
      status: 200, 
      headers: getCorsHeaders(request) 
    });

  } catch (error) {
    console.error(`❌ Cart API Error: ${error.message}\n`);
    
    return Response.json(
      { 
        status: 'error', 
        message: error.message || 'Failed to add to cart'
      },
      { 
        status: 500, 
        headers: getCorsHeaders(request) 
      }
    );
  }
}

function getCorsHeaders(request) {
  const origin = request.headers.get('Origin');
  return {
    'Access-Control-Allow-Origin': origin || '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Max-Age': '86400',
  };
}
