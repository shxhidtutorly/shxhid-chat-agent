/**
 * A3/A4 regression suite: getSystemPrompt is the single prompt source
 * (app/prompts/prompts.json was deleted as dead code). Known prompt types
 * resolve to distinct prompts; unknown types fall back to the default WITH
 * a warning (previously silent).
 *
 * Run with: node --test tests/
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

const { getSystemPrompt } = await import('../app/services/claude.server.js');

test('defined prompt types resolve to distinct prompts', () => {
  const assistant = getSystemPrompt('creativeAutomationAssistant');
  const b2b = getSystemPrompt('creativeAutomationB2B');
  assert.ok(assistant.length > 500);
  assert.ok(b2b.length > 500);
  assert.notEqual(assistant, b2b);
  assert.match(assistant, /Creative (Industrial )?Automation/);
});

test('unknown prompt type falls back to the default assistant and warns', () => {
  let warned = null;
  const orig = console.warn;
  console.warn = (msg) => { warned = msg; };
  try {
    const fallback = getSystemPrompt('standardAssistant');
    assert.equal(fallback, getSystemPrompt('creativeAutomationAssistant'));
  } finally {
    console.warn = orig;
  }
  assert.ok(warned && /Unknown promptType "standardAssistant"/.test(warned), 'must warn on unknown type');
});
