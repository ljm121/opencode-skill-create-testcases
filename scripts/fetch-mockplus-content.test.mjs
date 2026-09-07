import test from 'node:test';
import assert from 'node:assert/strict';
import {
  makeSafeName,
  shouldIncludeGroup,
  flattenModulePages,
} from './fetch-mockplus-content.mjs';

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

test('shouldIncludeGroup matches specified group name case-insensitively', () => {
  assert.equal(shouldIncludeGroup('系统小优化', '系统小优化', null), true);
  assert.equal(shouldIncludeGroup('系统小优化', '优化', null), true);
  assert.equal(shouldIncludeGroup('COR & ICP AI合规', '系统小优化', null), false);
});

test('shouldIncludeGroup filters out excluded groups', () => {
  assert.equal(shouldIncludeGroup('草稿（不要看）', null, '草稿'), false);
  assert.equal(shouldIncludeGroup('系统小优化', null, '草稿'), true);
  assert.equal(shouldIncludeGroup('草稿（不要看）', '草稿', '不要看'), false);
});

test('flattenModulePages filters module pages based on group options', () => {
  const mockPayload = {
    pages: [
      {
        isGroup: true,
        name: '系统小优化',
        children: [
          { _id: '1', name: '商务合同校验', dataURL: 'https://img.mockplus.cn/p1.html' },
          { _id: '2', name: '供应商收款带出', dataURL: 'https://img.mockplus.cn/p2.html' },
        ],
      },
      {
        isGroup: true,
        name: '草稿（不要看）',
        children: [
          { _id: '3', name: '临时测试页', dataURL: 'https://img.mockplus.cn/p3.html' },
        ],
      },
    ],
  };

  const allModules = flattenModulePages(mockPayload);
  assert.equal(allModules.length, 3);

  const filtered = flattenModulePages(mockPayload, { group: '系统小优化' });
  assert.equal(filtered.length, 2);
  assert.deepEqual(filtered.map((m) => m.name), ['商务合同校验', '供应商收款带出']);

  const excluded = flattenModulePages(mockPayload, { excludeGroup: '草稿' });
  assert.equal(excluded.length, 2);
  assert.deepEqual(excluded.map((m) => m.name), ['商务合同校验', '供应商收款带出']);
});
