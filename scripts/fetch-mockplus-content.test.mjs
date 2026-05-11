import test from 'node:test';
import assert from 'node:assert/strict';
import { makeSafeName } from './fetch-mockplus-content.mjs';

test('makeSafeName strips protocol and special chars', () => {
  assert.equal(makeSafeName('https://example.com/page'), 'example.com-page');
  assert.equal(makeSafeName('http://mockplus.cn/s/abc'), 'mockplus.cn-s-abc');
});

test('makeSafeName replaces special characters with hyphens', () => {
  const result = makeSafeName('https://app.mockplus.cn/s/5pwWvD7V7?foo=bar&baz=1');
  assert.ok(!result.includes('?'));
  assert.ok(!result.includes('='));
  assert.ok(!result.includes('&'));
  assert.ok(result.includes('mockplus'));
  assert.ok(result.includes('5pwwvd7v7'));
});

test('makeSafeName collapses multiple hyphens', () => {
  assert.equal(makeSafeName('https://a.com/x//y'), 'a.com-x-y');
});

test('makeSafeName trims leading/trailing hyphens', () => {
  assert.equal(makeSafeName('https://test.com/'), 'test.com');
});

test('makeSafeName lowercases result', () => {
  const result = makeSafeName('https://MockPlus.CN/SHARE/ABC');
  assert.equal(result, 'mockplus.cn-share-abc');
});
