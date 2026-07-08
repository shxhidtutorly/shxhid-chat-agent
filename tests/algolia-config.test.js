/**
 * B1 regression suite: Algolia is only "configured" when ALL THREE env vars
 * are present — a missing ALGOLIA_INDEX_NAME used to silently search a
 * hardcoded default index and degrade every query to the weak fallbacks.
 *
 * Run with: node --test tests/
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

// Each test file runs in its own process, so env mutation here cannot leak
// into the other suites.
delete process.env.ALGOLIA_APP_ID;
delete process.env.ALGOLIA_SEARCH_KEY;
delete process.env.ALGOLIA_INDEX_NAME;

const { isAlgoliaConfigured, algoliaSearch } = await import('../app/services/algolia.server.js');

test('unconfigured when all Algolia env vars are missing', () => {
  assert.equal(isAlgoliaConfigured(), false);
});

test('app id + search key WITHOUT index name is NOT configured (B1)', () => {
  process.env.ALGOLIA_APP_ID = 'test-app';
  process.env.ALGOLIA_SEARCH_KEY = 'test-key';
  delete process.env.ALGOLIA_INDEX_NAME;
  assert.equal(isAlgoliaConfigured(), false);
});

test('all three env vars present is configured', () => {
  process.env.ALGOLIA_APP_ID = 'test-app';
  process.env.ALGOLIA_SEARCH_KEY = 'test-key';
  process.env.ALGOLIA_INDEX_NAME = 'shopify_shxhidproducts';
  assert.equal(isAlgoliaConfigured(), true);
});

test('algoliaSearch refuses to guess an index name and reports an error shape', async () => {
  process.env.ALGOLIA_APP_ID = 'test-app';
  process.env.ALGOLIA_SEARCH_KEY = 'test-key';
  delete process.env.ALGOLIA_INDEX_NAME;
  const result = await algoliaSearch('abb circuit breaker', { first: 10 });
  assert.ok(result, 'must not return null (error must be distinguishable from empty)');
  assert.equal(result.products.length, 0);
  assert.match(result.error, /not_configured/);
});
