/**
 * B3 regression suite: Shopify search syntax supports PREFIX wildcards only
 * (https://shopify.dev/docs/api/usage/search-syntax). The Tier-2 Admin query
 * builder must never emit a leading wildcard (`title:*token*`), and the
 * broadening pass must cover vendor/product_type/sku, not just title.
 *
 * Run with: node --test tests/
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

const { buildAdminSearchQueries } = await import('../app/services/admin-products.server.js');

test('multi-token query: pass 1 is a title prefix AND-clause', () => {
  const [pass1] = buildAdminSearchQueries('abb circuit breaker', ['abb', 'circuit', 'breaker']);
  assert.equal(pass1, 'title:abb* AND title:circuit* AND title:breaker*');
});

test('pass 2 broadens the first token across title/vendor/product_type/sku', () => {
  const passes = buildAdminSearchQueries('abb circuit breaker', ['abb', 'circuit', 'breaker']);
  assert.equal(passes.length, 2);
  assert.equal(passes[1], 'title:abb* OR vendor:abb* OR product_type:abb* OR sku:abb*');
});

test('short/no-token query falls back to a single prefix phrase pass', () => {
  const passes = buildAdminSearchQueries('ab', []);
  assert.deepEqual(passes, ['title:ab* OR vendor:ab*']);
});

test('no query ever contains a leading wildcard (unsupported by Shopify syntax)', () => {
  for (const q of [
    ...buildAdminSearchQueries('abb circuit breaker', ['abb', 'circuit', 'breaker']),
    ...buildAdminSearchQueries('ab', []),
    ...buildAdminSearchQueries('sensor', ['sensor']),
  ]) {
    assert.ok(!q.includes(':*'), `leading wildcard found in: ${q}`);
  }
});
