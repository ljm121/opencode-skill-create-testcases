import test from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';

import {
  findImaApiScript,
  findCosUploadScript,
  readZipEntries,
  topicTreeToMarkdown,
  extractEntities,
  diffBaseline,
  mergeTopicTrees,
  scoreItemRelevance,
  extractModuleTopicsFromXmind,
  formatArchivedFileName,
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
    title: '用户中心模块',
    notes: {
      plain: {
        content: '入口在顶部导航栏',
      },
    },
    children: {
      attached: [
        {
          title: '个人信息设置',
          children: {
            attached: [
              { title: '手机号格式校验' },
              { title: '自动带出用户名' },
            ],
          },
        },
      ],
    },
  };

  const lines = topicTreeToMarkdown(topic);
  assert.equal(lines[0], '- 用户中心模块');
  assert.equal(lines[1], '  > 备注: 入口在顶部导航栏');
  assert.equal(lines[2], '  - 个人信息设置');
  assert.equal(lines[3], '    - 手机号格式校验');
  assert.equal(lines[4], '    - 自动带出用户名');
});

test('extractEntities extracts bullet and bracket names correctly', () => {
  const sample = `
  - 用户账号字段
  - 【支付金额】
  - [权限验证规则]
  `;
  const entities = extractEntities(sample);
  assert.ok(entities.has('用户账号字段'));
  assert.ok(entities.has('支付金额'));
  assert.ok(entities.has('权限验证规则'));
});

test('diffBaseline classifies added, modified, and regression items', () => {
  const baseline = `
  - 用户账号认证
  - 基础信息填写
  - 提交审核
  `;

  const newSpec = `
  - 基础信息填写
  - 身份双重认证 (新增字段，必填且置灰)
  - 提交审核 (弱校验，不阻止提交)
  `;

  const result = diffBaseline(baseline, newSpec);
  assert.equal(result.summary.addedCount, 1);
  assert.equal(result.added[0].name, '身份双重认证');

  assert.equal(result.summary.modifiedCount, 1);
  assert.equal(result.modified[0].name, '提交审核');

  assert.ok(result.markdown.includes('增量差异矩阵'));
  assert.ok(result.markdown.includes('身份双重认证'));
  assert.ok(result.markdown.includes('Added'));
});

test('findCosUploadScript locates cos-upload.cjs or candidate path', () => {
  const scriptPath = findCosUploadScript();
  if (scriptPath) {
    assert.ok(scriptPath.endsWith('cos-upload.cjs'));
  }
});

test('mergeTopicTrees merges existing branches and appends tagged new branches', () => {
  const baseRoot = {
    title: '系统根导图',
    children: {
      attached: [
        {
          title: '用户认证模块',
          children: {
            attached: [
              { title: '账号密码登录' },
              { title: '手机验证码登录' },
            ],
          },
        },
      ],
    },
  };

  const newTree = {
    title: '本次迭代',
    children: {
      attached: [
        {
          title: '用户认证模块',
          children: {
            attached: [
              { title: '指纹生物识别 (新增)' },
            ],
          },
        },
        {
          title: '权限管理模块',
          children: {
            attached: [
              { title: '多角色权限分配' },
            ],
          },
        },
      ],
    },
  };

  const merged = mergeTopicTrees(baseRoot, newTree, { versionTag: 'V2.0.0' });

  assert.equal(merged.children.attached.length, 2);

  // 1. Merged existing branch
  const authBranch = merged.children.attached.find((b) => b.title === '用户认证模块');
  assert.ok(authBranch);
  assert.equal(authBranch.children.attached.length, 3);
  assert.equal(authBranch.children.attached[2].title, '指纹生物识别 (新增)');

  // 2. Appended new branch with version tag
  const permissionBranch = merged.children.attached.find((b) => b.title.includes('权限管理模块'));
  assert.ok(permissionBranch);
  assert.equal(permissionBranch.title, '【V2.0.0】 权限管理模块');
});

test('scoreItemRelevance computes matching scores accurately across business domains', () => {
  // 1. Exact substring match -> 100
  assert.equal(scoreItemRelevance('用户中心模块', '用户中心模块-基础版.xmind'), 100);
  assert.equal(scoreItemRelevance('购物车结算', '购物车结算中心.xmind'), 100);

  // 2. High semantic / keyword overlap -> >= 50
  assert.ok(scoreItemRelevance('用户中心设置-Web端', '用户中心设置详情.xmind') >= 60);
  assert.ok(scoreItemRelevance('购物车结算-优惠券抵扣', '购物车结算中心.xmind') >= 50);
  assert.ok(scoreItemRelevance('用户收货地址管理', '用户中心_地址管理.xmind') >= 50);

  // 3. Completely unrelated -> 0
  assert.equal(scoreItemRelevance('用户中心配置', '完全不相关的文档.xmind'), 0);
});

test('extractModuleTopicsFromXmind extracts first-level module branches', () => {
  const content = [
    {
      rootTopic: {
        title: '系统功能总览',
        children: {
          attached: [
            { title: '订单管理模块', children: { attached: [{ title: '订单列表查询' }] } },
            { title: '商品中心模块', children: { attached: [{ title: '商品上架与库存' }] } },
          ],
        },
      },
    },
  ];

  const zipBuf = createMockZipBuffer('content.json', JSON.stringify(content), true);
  const modules = extractModuleTopicsFromXmind(zipBuf);

  assert.equal(modules.length, 2);
  assert.equal(modules[0].moduleName, '订单管理模块');
  assert.equal(modules[1].moduleName, '商品中心模块');
});

test('formatArchivedFileName respects original name or appends version tag without generic _merged', () => {
  // 1. Original name with versionTag already inside
  const name1 = formatArchivedFileName('V2.0.0用户中心功能测试用例.xmind', { versionTag: 'V2.0.0', mode: 'new-file' });
  assert.equal(name1, 'V2.0.0用户中心功能测试用例.xmind');

  // 2. Original name without versionTag -> appends version tag
  const name2 = formatArchivedFileName('用户中心功能测试用例.xmind', { versionTag: 'V2.0.0', mode: 'new-file' });
  assert.equal(name2, '用户中心功能测试用例_V2.0.0.xmind');

  // 3. Merge mode with target historical title and versionTag
  const name3 = formatArchivedFileName('temp.xmind', { versionTag: 'V2.0.0', mode: 'merge', targetTitle: '用户中心设置详情.xmind' });
  assert.equal(name3, '用户中心设置详情_V2.0.0.xmind');

  // 4. Merge mode without versionTag -> preserves original target file name
  const name4 = formatArchivedFileName('temp.xmind', { versionTag: '', mode: 'merge', targetTitle: '用户中心设置详情.xmind' });
  assert.equal(name4, '用户中心设置详情.xmind');
});
