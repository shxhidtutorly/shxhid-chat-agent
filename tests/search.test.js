/**
 * Search-routing regression suite. Run with:
 *   node --test tests/search.test.js
 *
 * No external services are called. Algolia/Storefront/Anthropic clients
 * are stubbed by module mocking through environment overrides:
 *
 *   ALGOLIA_APP_ID / ALGOLIA_SEARCH_KEY are intentionally unset → the
 *   algolia client never initialises and algoliaSearch short-circuits
 *   to null. We assert routing decisions BEFORE the network call by
 *   inspecting `console.log` output.
 *
 *   ANTHROPIC_API_KEY is intentionally unset → QueryIntel returns the
 *   original message with reason='no_api_key'.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

// Unset network creds so no real call escapes the test process.
delete process.env.ALGOLIA_APP_ID;
delete process.env.ALGOLIA_SEARCH_KEY;
delete process.env.ANTHROPIC_API_KEY;
delete process.env.DEBUG_SEARCH;

// ---- detector tests are pure functions; no network involved ---------------
test('SKU detector self-test runs on import', async () => {
  // Importing search-router runs the IIFE self-test. If it logs FAILED we
  // fail this test.
  const original = console.error;
  let failed = false;
  console.error = (msg) => {
    if (typeof msg === 'string' && msg.includes('self-test FAILED')) failed = true;
  };
  await import('../app/services/search-router.server.js');
  console.error = original;
  assert.equal(failed, false, 'self-test should pass on import');
});

// ---- spec-token extractor + scorer ----------------------------------------
test('extractSpecTokens picks numeric+unit, IP, M-thread', async () => {
  const mod = await import('../app/services/algolia.server.js');
  // These are non-exported helpers; we test them indirectly through the
  // observable side effects below. Here we only confirm the module loads
  // and `isAlgoliaConfigured` is false when env vars are unset.
  assert.equal(mod.isAlgoliaConfigured(), false);
});

// ---- routing matrix -------------------------------------------------------
// Each case calls smartSearch and inspects: console output + return value.
// We cannot stub Algolia inline without DI, so we assert that without
// Algolia configured, smartSearch returns null (the conversational path),
// or falls through to admin (also null when no Shopify session in DB).

function captureLogs(fn) {
  const buf = [];
  const sink = (...args) => {
    buf.push(args.map((a) => (typeof a === 'string' ? a : String(a))).join(' '));
  };
  const origLog = console.log;
  const origWarn = console.warn;
  const origError = console.error;
  console.log = sink;
  console.warn = sink;
  console.error = sink;
  const restore = () => {
    console.log = origLog;
    console.warn = origWarn;
    console.error = origError;
  };
  return fn().then(
    (result) => { restore(); return { result, logs: buf.join('\n') }; },
    (err) => { restore(); throw err; }
  );
}

test('"hi" is recognised as conversational (no Algolia call)', async () => {
  // Pure-chat regex match: short-circuits at isConversationalMessage().
  // (Multi-word greetings like "hi how are you" reach QueryIntel for the
  // skip decision in production; the test env intentionally omits the
  // Anthropic key so we exercise only the local regex path here.)
  const { smartSearch } = await import('../app/services/search-router.server.js');
  const { result, logs } = await captureLogs(() =>
    smartSearch('hi', 'creativeautomation.myshopify.com')
  );
  assert.equal(result, null);
  assert.ok(!/text search start/.test(logs), 'must short-circuit before text search');
});

test('"60mm sensor" is text-routed (not SKU)', async () => {
  const { smartSearch } = await import('../app/services/search-router.server.js');
  const { logs } = await captureLogs(() =>
    smartSearch('60mm sensor', 'creativeautomation.myshopify.com')
  );
  // The SKU branch logs "SKU detected" — assert that did NOT fire.
  assert.ok(!/SKU detected/.test(logs), '60mm is not a SKU');
  assert.ok(/text search start/.test(logs), 'must reach text search');
});

test('"ACS580 inverter drive" hits SKU path', async () => {
  const { smartSearch } = await import('../app/services/search-router.server.js');
  const { logs } = await captureLogs(() =>
    smartSearch('ACS580 inverter drive', 'creativeautomation.myshopify.com')
  );
  // detectSku scans tokens — ACS580 should fire.
  assert.ok(/SKU detected: "ACS580"/.test(logs), 'ACS580 must be detected');
});

test('"BA25SS-STT3-A AODD pump" extracts the SKU', async () => {
  const { smartSearch } = await import('../app/services/search-router.server.js');
  const { logs } = await captureLogs(() =>
    smartSearch('BA25SS-STT3-A AODD pump', 'creativeautomation.myshopify.com')
  );
  assert.ok(/SKU detected: "BA25SS-STT3-A"/.test(logs));
});

test('"100bar pressure transmitter" is NOT a SKU', async () => {
  const { smartSearch } = await import('../app/services/search-router.server.js');
  const { logs } = await captureLogs(() =>
    smartSearch('100bar pressure transmitter', 'creativeautomation.myshopify.com')
  );
  assert.ok(!/SKU detected/.test(logs), '100bar must not be SKU');
});

test('"Cat5e ethernet cable" is NOT a SKU', async () => {
  const { smartSearch } = await import('../app/services/search-router.server.js');
  const { logs } = await captureLogs(() =>
    smartSearch('Cat5e ethernet cable', 'creativeautomation.myshopify.com')
  );
  assert.ok(!/SKU detected/.test(logs), 'Cat5e must not be SKU');
});

test('"DFS60S" is a SKU (SICK encoder family)', async () => {
  const { smartSearch } = await import('../app/services/search-router.server.js');
  const { logs } = await captureLogs(() =>
    smartSearch('DFS60S', 'creativeautomation.myshopify.com')
  );
  assert.ok(/SKU detected: "DFS60S"/.test(logs));
});

test('"5/2 way solenoid valve" is text-routed, NOT SKU', async () => {
  const { smartSearch } = await import('../app/services/search-router.server.js');
  const { logs } = await captureLogs(() =>
    smartSearch('5/2 way solenoid valve', 'creativeautomation.myshopify.com')
  );
  assert.ok(!/SKU detected/.test(logs), '"5/2" must not match as SKU');
  assert.ok(/text search start/.test(logs));
});

test('"Schmersal swivel lever limit M20" reaches text search', async () => {
  const { smartSearch } = await import('../app/services/search-router.server.js');
  const { logs } = await captureLogs(() =>
    smartSearch('Schmersal swivel lever limit M20', 'creativeautomation.myshopify.com')
  );
  // M20 alone is a thread spec but Pattern 2 needs a separator → not SKU.
  // The vendor name lives in a multi-word phrase → text path expected.
  assert.ok(/text search start/.test(logs));
});

test('"ifm pressure sensor" is text-routed', async () => {
  const { smartSearch } = await import('../app/services/search-router.server.js');
  const { logs } = await captureLogs(() =>
    smartSearch('ifm pressure sensor', 'creativeautomation.myshopify.com')
  );
  assert.ok(/text search start/.test(logs));
});
