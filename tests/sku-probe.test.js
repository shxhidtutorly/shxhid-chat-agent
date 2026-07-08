/**
 * B4 regression suite: skuCandidateTokens() feeds the always-on exact-SKU
 * probe. It must surface plausible part numbers the regex classifier could
 * miss, while never treating measurements/ratings/cable categories as SKUs
 * (a false candidate costs an exact-match Admin query; it must stay rare).
 *
 * Run with: node --test tests/
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

delete process.env.ALGOLIA_APP_ID;
delete process.env.ALGOLIA_SEARCH_KEY;
delete process.env.ANTHROPIC_API_KEY;

const { skuCandidateTokens } = await import('../app/services/search-router.server.js');

test('extracts SKU-ish tokens the regex classifier can miss', () => {
  assert.deepEqual(skuCandidateTokens('do you have E125 in stock'), ['E125']);
  assert.deepEqual(skuCandidateTokens('need BA25SS-STT3-A pump'), ['BA25SS-STT3-A']);
  assert.deepEqual(skuCandidateTokens('price for ACS580 drive'), ['ACS580']);
});

test('never treats measurements, ratings, or cable categories as SKU candidates', () => {
  assert.deepEqual(skuCandidateTokens('60mm sensing range 24VDC 100bar'), []);
  assert.deepEqual(skuCandidateTokens('IP67 Cat5e cable 2.5mm'), []);
  assert.deepEqual(skuCandidateTokens('3ft 100A 50Hz 3000rpm'), []);
});

test('plain category queries produce no candidates (no wasted Admin calls)', () => {
  assert.deepEqual(skuCandidateTokens('show me proximity sensors'), []);
  assert.deepEqual(skuCandidateTokens('ABB circuit breakers'), []);
});

test('strips surrounding punctuation and dedupes, caps at 3', () => {
  assert.deepEqual(skuCandidateTokens('"S201-B16", (S201-B16)!'), ['S201-B16']);
  assert.deepEqual(
    skuCandidateTokens('A1B2C A2B3C A3B4C A4B5C A5B6C'),
    ['A1B2C', 'A2B3C', 'A3B4C']
  );
});

test('tokens shorter than 4 chars or without both letters and digits are ignored', () => {
  // M12 (3 chars), 1234 (no letters), ABCD (no digits) are all ignored;
  // G1/2 is a legitimate thread-code candidate (the regex classifier also
  // treats it as a SKU, so in smartSearch the probe would skip it as
  // already-tried).
  assert.deepEqual(skuCandidateTokens('M12 G1/2 1234 ABCD'), ['G1/2']);
});
