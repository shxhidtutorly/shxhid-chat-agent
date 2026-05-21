#!/usr/bin/env node
/**
 * One-shot Algolia record inspector.
 *
 * Usage:
 *   ALGOLIA_APP_ID=... ALGOLIA_SEARCH_KEY=... ALGOLIA_INDEX_NAME=... \
 *     node scripts/algolia-inspect.js
 *
 * Calls Algolia `search` with hitsPerPage=1 (no filters) to fetch the
 * first record from the configured index, then prints:
 *   1. The full list of attribute keys
 *   2. The type of each top-level value
 *   3. A truncated JSON preview of the record itself
 *
 * Purpose: confirm exactly what the Shopify→Algolia connector indexes
 * for this store, so search-router decisions about variant lookup,
 * vendor filters, and business-signal ranking can be grounded in
 * verified shape rather than guesses.
 */

import { algoliasearch } from 'algoliasearch';

const appId = process.env.ALGOLIA_APP_ID;
const apiKey = process.env.ALGOLIA_SEARCH_KEY;
const indexName = process.env.ALGOLIA_INDEX_NAME || 'shopify_products';

if (!appId || !apiKey) {
  console.error('Missing ALGOLIA_APP_ID / ALGOLIA_SEARCH_KEY env vars.');
  process.exit(2);
}

const client = algoliasearch(appId, apiKey);

const res = await client.search({
  requests: [{ indexName, query: '', hitsPerPage: 1 }],
});

const hit = res?.results?.[0]?.hits?.[0];
if (!hit) {
  console.error(`No records found in index "${indexName}".`);
  process.exit(1);
}

console.log(`# index: ${indexName}`);
console.log(`# nbHits: ${res.results[0].nbHits}`);
console.log(`# sample objectID: ${hit.objectID}`);
console.log('');
console.log('## All attribute keys');
const keys = Object.keys(hit).sort();
for (const k of keys) {
  const v = hit[k];
  let t = typeof v;
  if (Array.isArray(v)) t = `array(len=${v.length})`;
  else if (v === null) t = 'null';
  else if (t === 'object') t = `object{${Object.keys(v).slice(0, 5).join(',')}${Object.keys(v).length > 5 ? ',...' : ''}}`;
  let sample = '';
  if (t === 'string') sample = JSON.stringify(v.slice(0, 60));
  else if (t === 'number' || t === 'boolean') sample = String(v);
  else if (Array.isArray(v) && v.length > 0) {
    sample = JSON.stringify(v[0]).slice(0, 80);
  }
  console.log(`  ${k}: ${t}${sample ? ' = ' + sample : ''}`);
}

console.log('');
console.log('## Full record (truncated to 4000 chars)');
console.log(JSON.stringify(hit, null, 2).slice(0, 4000));
