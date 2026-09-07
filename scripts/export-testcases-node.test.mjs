import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

import {
  crc32,
  createZipArchive,
  createXlsxBuffer,
  createXmindBuffer,
  createMarkdownString,
  exportTestcases,
} from './export-testcases.mjs';
import { readZipEntries } from './ima-bridge.mjs';

test('crc32 computes consistent checksums', () => {
  const buf1 = Buffer.from('hello world');
  const buf2 = Buffer.from('hello world');
  assert.equal(crc32(buf1), crc32(buf2));
  assert.notEqual(crc32(buf1), crc32(Buffer.from('different')));
});

test('createZipArchive produces a valid zip readable by readZipEntries', () => {
  const files = {
    'test.txt': 'Hello pure Node.js zip',
    'dir/sub.json': '{"ok":true}',
  };

  const zipBuf = createZipArchive(files);
  const entries = readZipEntries(zipBuf);

  assert.ok(entries['test.txt']);
  assert.equal(entries['test.txt'].toString('utf8'), 'Hello pure Node.js zip');
  assert.ok(entries['dir/sub.json']);
  assert.equal(entries['dir/sub.json'].toString('utf8'), '{"ok":true}');
});

test('createXlsxBuffer produces valid OpenXML xlsx structure', () => {
  const rows = [
    ['功能模块', '场景分类', '用例标题', '测试步骤', '预期结果', '优先级', '测试类型'],
    ['用户管理', '字段校验', '手机号必填校验', '1. 进入页面；2. 查看字段', '手机号标红提示必填', 'P1', '功能'],
  ];

  const xlsxBuf = createXlsxBuffer(rows, 'TestCases');
  const entries = readZipEntries(xlsxBuf);

  assert.ok(entries['[Content_Types].xml']);
  assert.ok(entries['xl/workbook.xml']);
  assert.ok(entries['xl/sharedStrings.xml']);
  assert.ok(entries['xl/worksheets/sheet1.xml']);

  const sharedStringsXml = entries['xl/sharedStrings.xml'].toString('utf8');
  assert.ok(sharedStringsXml.includes('手机号必填校验'));
});

test('createXmindBuffer produces valid XMind archive with content.json', () => {
  const rootNode = {
    title: '系统功能总览',
    children: [
      {
        title: '用户中心模块',
        children: [
          { title: '个人信息设置' },
        ],
      },
    ],
  };

  const xmindBuf = createXmindBuffer(rootNode, '系统功能总览');
  const entries = readZipEntries(xmindBuf);

  assert.ok(entries['content.json']);
  assert.ok(entries['manifest.json']);

  const contentJson = JSON.parse(entries['content.json'].toString('utf8'));
  assert.equal(contentJson[0].rootTopic.title, '系统功能总览');
  assert.equal(contentJson[0].rootTopic.children.attached[0].title, '用户中心模块');
});

test('createMarkdownString produces formatted markdown table', () => {
  const payload = {
    documentSummary: { name: '测试模块', type: 'prototype' },
    prefix: 'TEST',
    testCases: [
      {
        id: 'TEST-001',
        module: '登录',
        scenario: '正向',
        title: '成功登录',
        steps: ['输入账号密码', '点击登录'],
        expectedResult: '跳转首页',
        priority: 'P1',
        testType: '功能',
      },
    ],
  };

  const md = createMarkdownString(payload);
  assert.ok(md.includes('# 测试模块'));
  assert.ok(md.includes('| TEST-001 | 登录 | 正向 | 成功登录 |'));
});

test('exportTestcases generates all 3 artifacts and respects preview', async () => {
  const payload = {
    documentSummary: { name: '自动化纯Node测试' },
    prefix: 'NODE',
    testCases: [
      {
        module: '核心模块',
        scenario: '主流程',
        title: '测试用例 1',
        steps: ['步骤 1'],
        expectedResult: '成功',
        priority: 'P1',
        testType: '功能',
      },
    ],
  };

  // Preview mode
  const previewResult = await exportTestcases(payload, { preview: true });
  assert.equal(previewResult.success, true);
  assert.equal(previewResult.preview, true);

  // Actual export to temp dir
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'node-export-test-'));
  try {
    const result = await exportTestcases(payload, { outputDir: tempDir });
    assert.equal(result.success, true);
    assert.equal(result.outputs.length, 3);

    const files = await fs.readdir(tempDir);
    assert.ok(files.includes('自动化纯Node测试.md'));
    assert.ok(files.includes('自动化纯Node测试.xlsx'));
    assert.ok(files.includes('自动化纯Node测试.xmind'));
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
});
