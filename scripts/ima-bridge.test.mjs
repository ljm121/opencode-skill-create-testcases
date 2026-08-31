import test from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';

import {
  findImaApiScript,
  readZipEntries,
  topicTreeToMarkdown,
  extractEntities,
  diffBaseline,
} from './ima-bridge.mjs';

function createMockZipBuffer(filename, content, compress = true) {
  const contentBuf = Buffer.from(content, 'utf8');
  const filenameBuf = Buffer.from(filename, 'utf8');
  const compressed = compress ? zlib.deflateRawSync(contentBuf) : contentBuf;
  const compMethod = compress ? 8 : 0;

  // Local File Header
  const lfh = Buffer.alloc(30 + filenameBuf.length + compressed.length);
  lfh.writeUInt32LE(0x04034b50, 0); // Signature
  lfh.writeUInt16LE(20, 4); // Version needed
  lfh.writeUInt16LE(0, 6); // Flags
  lfh.writeUInt16LE(compMethod, 8); // Compression method
  lfh.writeUInt16LE(0, 10); // Time
  lfh.writeUInt16LE(0, 12); // Date
  lfh.writeUInt32LE(0, 14); // CRC32 (ignored for test)
  lfh.writeUInt32LE(compressed.length, 18); // Compressed size
  lfh.writeUInt32LE(contentBuf.length, 22); // Uncompressed size
  lfh.writeUInt16LE(filenameBuf.length, 26); // Filename length
  lfh.writeUInt16LE(0, 28); // Extra field length
  filenameBuf.copy(lfh, 30);
  compressed.copy(lfh, 30 + filenameBuf.length);

  // Central Directory File Header
  const cdfh = Buffer.alloc(46 + filenameBuf.length);
  cdfh.writeUInt32LE(0x02014b50, 0); // Signature
  cdfh.writeUInt16LE(20, 4); // Version made by
  cdfh.writeUInt16LE(20, 6); // Version needed
  cdfh.writeUInt16LE(0, 8); // Flags
  cdfh.writeUInt16LE(compMethod, 10); // Compression method
  cdfh.writeUInt16LE(0, 12); // Time
  cdfh.writeUInt16LE(0, 14); // Date
  cdfh.writeUInt32LE(0, 16); // CRC32
  cdfh.writeUInt32LE(compressed.length, 20); // Compressed size
  cdfh.writeUInt32LE(contentBuf.length, 24); // Uncompressed size
  cdfh.writeUInt16LE(filenameBuf.length, 28); // Filename length
  cdfh.writeUInt16LE(0, 30); // Extra field length
  cdfh.writeUInt16LE(0, 32); // Comment length
  cdfh.writeUInt16LE(0, 34); // Disk number start
  cdfh.writeUInt16LE(0, 36); // Internal file attributes
  cdfh.writeUInt32LE(0, 38); // External file attributes
  cdfh.writeUInt32LE(0, 42); // Relative offset of local header
  filenameBuf.copy(cdfh, 46);

  // End of Central Directory Record
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); // Signature
  eocd.writeUInt16LE(0, 4); // Disk number
  eocd.writeUInt16LE(0, 6); // Disk number with CD
  eocd.writeUInt16LE(1, 8); // Entries on disk
  eocd.writeUInt16LE(1, 10); // Total entries
  eocd.writeUInt32LE(cdfh.length, 12); // CD size
  eocd.writeUInt32LE(lfh.length, 16); // CD offset
  eocd.writeUInt16LE(0, 20); // Comment length

  return Buffer.concat([lfh, cdfh, eocd]);
}

test('findImaApiScript locates CLI script in candidate paths or returns string', () => {
  const scriptPath = findImaApiScript();
  assert.ok(typeof scriptPath === 'string');
  assert.ok(scriptPath.endsWith('ima_api.cjs'));
});

test('readZipEntries decompresses deflate entry correctly', () => {
  const expectedContent = '{"rootTopic":{"title":"测试思维导图"}}';
  const zipBuf = createMockZipBuffer('content.json', expectedContent, true);

  const entries = readZipEntries(zipBuf);
  assert.ok(entries['content.json']);
  assert.equal(entries['content.json'].toString('utf8'), expectedContent);
});

test('readZipEntries decompresses stored entry correctly', () => {
  const expectedContent = 'Hello XMind';
  const zipBuf = createMockZipBuffer('test.txt', expectedContent, false);

  const entries = readZipEntries(zipBuf);
  assert.ok(entries['test.txt']);
  assert.equal(entries['test.txt'].toString('utf8'), expectedContent);
});

test('readZipEntries throws on corrupted buffer', () => {
  const corruptBuf = Buffer.from('Not a zip archive');
  assert.throws(() => readZipEntries(corruptBuf), /无效的 ZIP \/ XMind 归档文件/);
});

test('topicTreeToMarkdown formats nested topic tree and notes into markdown', () => {
  const topic = {
    title: '商务合同发起',
    notes: {
      plain: {
        content: '入口在商务合同管理',
      },
    },
    children: {
      attached: [
        {
          title: '合作产品',
          children: {
            attached: [
              { title: '必填校验' },
              { title: '自动带出商机' },
            ],
          },
        },
      ],
    },
  };

  const lines = topicTreeToMarkdown(topic);
  assert.equal(lines[0], '- 商务合同发起');
  assert.equal(lines[1], '  > 备注: 入口在商务合同管理');
  assert.equal(lines[2], '  - 合作产品');
  assert.equal(lines[3], '    - 必填校验');
  assert.equal(lines[4], '    - 自动带出商机');
});

test('extractEntities extracts bullet and bracket names correctly', () => {
  const sample = `
  - 客户签约主体
  - 【合作产品】
  - [审批注意事项]
  `;
  const entities = extractEntities(sample);
  assert.ok(entities.has('客户签约主体'));
  assert.ok(entities.has('合作产品'));
  assert.ok(entities.has('审批注意事项'));
});

test('diffBaseline classifies added, modified, and regression items', () => {
  const baseline = `
  - 关联纷享销客商机
  - 客户签约主体
  - 发起审批
  `;

  const newSpec = `
  - 客户签约主体
  - 合作产品 (新增字段，必填且置灰)
  - 发起审批 (弱校验，不阻止提交)
  `;

  const result = diffBaseline(baseline, newSpec);
  assert.equal(result.summary.addedCount, 1);
  assert.equal(result.added[0].name, '合作产品');

  assert.equal(result.summary.modifiedCount, 1);
  assert.equal(result.modified[0].name, '发起审批');

  assert.ok(result.markdown.includes('增量差异矩阵'));
  assert.ok(result.markdown.includes('合作产品'));
  assert.ok(result.markdown.includes('Added'));
});
