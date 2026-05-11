import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyRuntime } from './verify-runtime.mjs';

test('verifyRuntime returns ok with expected check names', async () => {
  const result = await verifyRuntime();

  assert.ok(result);
  assert.equal(typeof result.ok, 'boolean');
  assert.ok(Array.isArray(result.checks));
  assert.equal(result.checks.length, 3);

  const names = result.checks.map((c) => c.name);
  assert.deepEqual(names, ['package.json', 'playwright-module', 'playwright-chromium']);

  for (const check of result.checks) {
    assert.equal(typeof check.ok, 'boolean');
    assert.equal(typeof check.name, 'string');
  }
});

test('verifyRuntime includes skillRoot path', async () => {
  const result = await verifyRuntime();

  assert.ok(result.skillRoot);
  assert.ok(result.skillRoot.endsWith('create-testcases'));
});
