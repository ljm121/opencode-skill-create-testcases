import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import zlib from 'node:zlib';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/**
 * Locate ima_api.cjs script across user profile and environment paths
 */
export function findImaApiScript() {
  if (process.env.IMA_API_PATH && fs.existsSync(process.env.IMA_API_PATH)) {
    return process.env.IMA_API_PATH;
  }

  const homedir = os.homedir();
  const candidates = [
    'C:\\Users\\10152\\.agents\\skills\\ima-skill\\ima_api.cjs',
    path.join(homedir, '.agents', 'skills', 'ima-skill', 'ima_api.cjs'),
    path.join(homedir, '.gemini', 'config', 'skills', 'ima-skill', 'ima_api.cjs'),
    path.join(homedir, '.config', 'skills', 'ima-skill', 'ima_api.cjs'),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }

  return null;
}

/**
 * Call IMA OpenAPI using the discovered CLI
 */
export function callImaApi(endpoint, body = {}) {
  const scriptPath = findImaApiScript();
  if (!scriptPath) {
    throw new Error(
      '未找到 ima_api.cjs。请确认已配置 ima-skill 或设置环境变量 IMA_API_PATH。'
    );
  }

  const bodyStr = typeof body === 'string' ? body : JSON.stringify(body);
  const result = spawnSync('node', [scriptPath, endpoint, bodyStr], {
    encoding: 'utf8',
    timeout: 30000,
  });

  if (result.error) {
    throw new Error(`IMA API 执行失败: ${result.error.message}`);
  }

  let json;
  try {
    json = JSON.parse(result.stdout || '{}');
  } catch (err) {
    throw new Error(`无法解析 IMA API 返回结果: ${result.stdout || result.stderr}`);
  }

  if (json.code !== 0 && json.code !== 200) {
    throw new Error(`IMA API 错误 [${json.code}]: ${json.msg || '未知错误'}`);
  }

  return json;
}

/**
 * Pure Node.js ZIP extractor without external dependencies
 */
export function readZipEntries(buffer) {
  const entries = {};
  let eocdOffset = -1;

  // Search backwards for End of Central Directory signature 0x06054b50
  for (let i = buffer.length - 22; i >= 0; i -= 1) {
    if (buffer.readUInt32LE(i) === 0x06054b50) {
      eocdOffset = i;
      break;
    }
  }

  if (eocdOffset === -1) {
    throw new Error('无效的 ZIP / XMind 归档文件');
  }

  const cdOffset = buffer.readUInt32LE(eocdOffset + 16);
  const totalEntries = buffer.readUInt16LE(eocdOffset + 10);

  let cur = cdOffset;
  for (let i = 0; i < totalEntries; i += 1) {
    const sig = buffer.readUInt32LE(cur);
    if (sig !== 0x02014b50) break;

    const compMethod = buffer.readUInt16LE(cur + 10);
    const compSize = buffer.readUInt32LE(cur + 20);
    const fnLen = buffer.readUInt16LE(cur + 28);
    const extraLen = buffer.readUInt16LE(cur + 30);
    const commentLen = buffer.readUInt16LE(cur + 32);
    const localHeaderOffset = buffer.readUInt32LE(cur + 42);
    const filename = buffer.toString('utf8', cur + 46, cur + 46 + fnLen);

    // Read local header to get data offset
    const localFnLen = buffer.readUInt16LE(localHeaderOffset + 26);
    const localExtraLen = buffer.readUInt16LE(localHeaderOffset + 28);
    const dataOffset = localHeaderOffset + 30 + localFnLen + localExtraLen;

    const data = buffer.subarray(dataOffset, dataOffset + compSize);
    let decompressed;

    if (compMethod === 0) {
      decompressed = data;
    } else if (compMethod === 8) {
      decompressed = zlib.inflateRawSync(data);
    } else {
      throw new Error(`不支持的 ZIP 压缩格式: ${compMethod}`);
    }

    entries[filename] = decompressed;
    cur += 46 + fnLen + extraLen + commentLen;
  }

  return entries;
}

/**
 * Convert XMind root topic to hierarchical markdown string
 */
export function topicTreeToMarkdown(topic, indent = 0) {
  if (!topic) return [];
  const lines = [];
  const prefix = '  '.repeat(indent) + '- ';
  lines.push(prefix + (topic.title || ''));

  if (topic.notes?.plain?.content) {
    const noteText = topic.notes.plain.content.trim().replace(/\n+/g, ' ');
    lines.push('  '.repeat(indent + 1) + `> 备注: ${noteText}`);
  }

  const children = topic.children?.attached || [];
  for (const child of children) {
    lines.push(...topicTreeToMarkdown(child, indent + 1));
  }
  return lines;
}

/**
 * Search knowledge bases by name and return matching list
 */
export async function searchKnowledgeBases(query) {
  const res = callImaApi('openapi/wiki/v1/search_knowledge_base', { query, limit: 10 });
  const list = res.data?.info_list || [];
  return list.map((item) => ({
    id: item.kb_id,
    name: item.kb_name,
    knowledge_base_id: item.kb_id,
    description: item.description || '',
    creator: item.creator || '',
    contentCount: item.content_count || '0',
  }));
}

/**
 * Search knowledge items (files/folders) in a specific knowledge base
 */
export async function searchKnowledgeItems(kbId, query) {
  const res = callImaApi('openapi/wiki/v1/search_knowledge', {
    knowledge_base_id: kbId,
    query,
  });
  return res.data?.info_list || [];
}

/**
 * Get media content (XMind, Note, etc.) parsed as markdown
 */
export async function getMediaParsedContent(mediaId) {
  const res = callImaApi('openapi/wiki/v1/get_media_info', { media_id: mediaId });
  const info = res.data;
  if (!info) throw new Error(`未找到 media_id 为 ${mediaId} 的信息`);

  // Note type (media_type = 11)
  if (info.media_type === 11) {
    const docRes = callImaApi('openapi/note/v1/get_doc_content', { doc_id: mediaId });
    return {
      type: 'note',
      mediaId,
      title: info.media_title || '笔记文档',
      content: docRes.data?.content || '',
    };
  }

  // XMind type (media_type = 14)
  if (info.media_type === 14 || (info.media_title && info.media_title.endsWith('.xmind'))) {
    const urlInfo = info.url_info;
    if (!urlInfo || !urlInfo.url) {
      throw new Error(`无法获取 XMind 下载直链: ${mediaId}`);
    }

    const response = await fetch(urlInfo.url, { headers: urlInfo.headers || {} });
    if (!response.ok) {
      throw new Error(`下载 XMind 失败: HTTP ${response.status}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    const zipEntries = readZipEntries(Buffer.from(arrayBuffer));
    if (!zipEntries['content.json']) {
      throw new Error('XMind 文件中未找到 content.json');
    }

    const contentJson = JSON.parse(zipEntries['content.json'].toString('utf8'));
    const sheets = Array.isArray(contentJson) ? contentJson : [contentJson];
    const markdownLines = [];

    for (const sheet of sheets) {
      if (sheet.title) markdownLines.push(`### 画布：${sheet.title}`);
      if (sheet.rootTopic) {
        markdownLines.push(...topicTreeToMarkdown(sheet.rootTopic, 0));
      }
    }

    return {
      type: 'xmind',
      mediaId,
      title: info.media_title || 'XMind 思维导图',
      content: markdownLines.join('\n'),
    };
  }

  return {
    type: 'generic',
    mediaId,
    title: info.media_title || '文件条目',
    content: info.url_info?.url || '',
  };
}

/**
 * High-level baseline fetcher: finds matching KB -> searches items -> extracts content
 */
export async function fetchBaseline(kbName, query) {
  const kbs = await searchKnowledgeBases(kbName);
  if (!kbs.length) {
    throw new Error(`未找到名称包含 "${kbName}" 的知识库`);
  }

  const targetKb = kbs[0];
  const items = await searchKnowledgeItems(targetKb.knowledge_base_id, query);

  const matchedContents = [];
  for (const item of items.slice(0, 5)) {
    if (item.media_id) {
      try {
        const parsed = await getMediaParsedContent(item.media_id);
        matchedContents.push({
          title: item.title || parsed.title,
          type: parsed.type,
          content: parsed.content,
        });
      } catch (err) {
        matchedContents.push({
          title: item.title || item.media_id,
          type: 'error',
          content: `提取失败: ${err.message}`,
        });
      }
    }
  }

  return {
    kbName: targetKb.name,
    kbId: targetKb.knowledge_base_id,
    query,
    totalFound: items.length,
    items: matchedContents,
  };
}

/**
 * Extract entities (fields, buttons, rules, concepts) from a text or markdown string
 */
export function extractEntities(text = '') {
  const lines = text.split('\n');
  const entities = new Map();

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    const bulletMatch = line.match(/^[-*#]+\s*(?:【([^】]+)】|\[([^\]]+)\]|([^\s:：(（]+))/);
    const bracketMatch = line.match(/[【\[]([^】\]]+)[】\]]/);

    let name = '';
    if (bulletMatch) {
      name = (bulletMatch[1] || bulletMatch[2] || bulletMatch[3] || '').trim();
    } else if (bracketMatch) {
      name = bracketMatch[1].trim();
    }

    if (name && name.length >= 2 && name.length <= 30 && !/^(画布|模块|说明|正文|页面|交互|字段)$/.test(name)) {
      if (!entities.has(name)) {
        entities.set(name, { name, lines: [] });
      }
      entities.get(name).lines.push(line);
    }
  }

  return entities;
}

/**
 * Perform incremental diff analysis between baseline (As-Is) and new specification (To-Be)
 */
export function diffBaseline(baselineInput, newSpecInput) {
  const baselineText = typeof baselineInput === 'string'
    ? baselineInput
    : (Array.isArray(baselineInput?.items)
        ? baselineInput.items.map((i) => `${i.title}\n${i.content}`).join('\n\n')
        : JSON.stringify(baselineInput));

  const newSpecText = typeof newSpecInput === 'string'
    ? newSpecInput
    : JSON.stringify(newSpecInput);

  const baselineEntities = extractEntities(baselineText);
  const newEntities = extractEntities(newSpecText);

  const added = [];
  const modified = [];
  const regression = [];
  const unchanged = [];

  for (const [name, newEntity] of newEntities.entries()) {
    if (!baselineEntities.has(name)) {
      added.push({
        name,
        type: 'Added',
        asIs: '基线中未定义该对象/字段',
        toBe: newEntity.lines.slice(0, 3).join('; '),
        description: `新增项：${name}`,
      });
    } else {
      const baseLines = baselineEntities.get(name).lines.join(' ');
      const newLines = newEntity.lines.join(' ');

      const hasRuleChange = /(新增|变更|校验|置灰|拦截|toast|必填|警示|去重|弱校验|强校验|联动|自动带出)/.test(newLines);
      if (hasRuleChange && newLines !== baseLines) {
        modified.push({
          name,
          type: 'Modified',
          asIs: baseLines.slice(0, 100) || '已有基础逻辑',
          toBe: newLines.slice(0, 100),
          description: `逻辑变更：${name}`,
        });
      } else {
        unchanged.push(name);
      }
    }
  }

  for (const [name, baseEntity] of baselineEntities.entries()) {
    if (newEntities.has(name)) continue;
    const baseTextSnippet = baseEntity.lines.join(' ');
    const isImpacted = added.some((a) => baseTextSnippet.includes(a.name)) ||
                       modified.some((m) => baseTextSnippet.includes(m.name));
    if (isImpacted) {
      regression.push({
        name,
        type: 'Regression',
        asIs: baseTextSnippet.slice(0, 100),
        toBe: '保持既有流转不被新逻辑破坏',
        description: `潜在受波及既有存量：${name}`,
      });
    }
  }

  const markdownLines = [
    '### 增量差异矩阵（Diff Matrix）',
    '',
    '```text',
    `🟢 新增对象/字段 (Added)       : ${added.length} 项`,
    `🟡 变更逻辑/校验规则 (Modified) : ${modified.length} 项`,
    `🔵 需重点回归模块 (Regression) : ${regression.length} 项`,
    `⚪ 保持原样基线 (Unchanged)    : ${unchanged.length} 项`,
    '```',
    '',
    '| 对象/节点 | 差异分类 | 历史基线规范（As-Is） | 本次变更规范（To-Be） | 测试断言与影响 |',
    '|---|---|---|---|---|',
  ];

  for (const item of added) {
    markdownLines.push(`| **${item.name}** | 🟢 **Added** | ${item.asIs} | ${item.toBe} | 验证新对象渲染、交互与属性限制 |`);
  }
  for (const item of modified) {
    markdownLines.push(`| **${item.name}** | 🟡 **Modified** | ${item.asIs} | ${item.toBe} | 验证新老逻辑切换与分支校验 |`);
  }
  for (const item of regression) {
    markdownLines.push(`| **${item.name}** | 🔵 **Regression** | ${item.asIs} | ${item.toBe} | 验证既有核心流程不受变更破坏 |`);
  }

  return {
    summary: {
      addedCount: added.length,
      modifiedCount: modified.length,
      regressionCount: regression.length,
      unchangedCount: unchanged.length,
    },
    added,
    modified,
    regression,
    unchanged,
    markdown: markdownLines.join('\n'),
  };
}

/**
 * Locate cos-upload.cjs in ima-skill
 */
export function findCosUploadScript() {
  const imaScript = findImaApiScript();
  if (imaScript) {
    const candidate1 = path.join(path.dirname(imaScript), 'knowledge-base', 'scripts', 'cos-upload.cjs');
    if (fs.existsSync(candidate1)) return candidate1;
  }

  const homedir = os.homedir();
  const candidates = [
    'C:\\Users\\10152\\.agents\\skills\\ima-skill\\knowledge-base\\scripts\\cos-upload.cjs',
    path.join(homedir, '.agents', 'skills', 'ima-skill', 'knowledge-base', 'scripts', 'cos-upload.cjs'),
    path.join(homedir, '.gemini', 'config', 'skills', 'ima-skill', 'knowledge-base', 'scripts', 'cos-upload.cjs'),
  ];

  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }

  return null;
}

/**
 * Intelligently merge new topic branches into an existing XMind root topic
 */
export function mergeTopicTrees(baseRootTopic, newTopicOrTree, options = {}) {
  const merged = JSON.parse(JSON.stringify(baseRootTopic || { title: '导图', children: { attached: [] } }));
  if (!merged.children) {
    merged.children = { attached: [] };
  } else if (!Array.isArray(merged.children.attached)) {
    merged.children.attached = [];
  }

  const versionTag = options.versionTag ? `【${options.versionTag}】` : '';
  const newChildren = newTopicOrTree.children?.attached || newTopicOrTree.children || [];

  for (const newChild of newChildren) {
    const newTitle = newChild.title || '';
    const existing = merged.children.attached.find(
      (c) => c.title === newTitle || (newTitle && c.title && (c.title.includes(newTitle) || newTitle.includes(c.title)))
    );

    if (existing) {
      if (!existing.children) existing.children = { attached: [] };
      else if (!Array.isArray(existing.children.attached)) existing.children.attached = [];

      const subChildren = newChild.children?.attached || newChild.children || [];
      for (const sub of subChildren) {
        const subExists = existing.children.attached.find((s) => s.title === sub.title);
        if (!subExists) {
          existing.children.attached.push(JSON.parse(JSON.stringify(sub)));
        }
      }
    } else {
      const clonedChild = JSON.parse(JSON.stringify(newChild));
      if (versionTag && !clonedChild.title.startsWith(versionTag)) {
        clonedChild.title = `${versionTag} ${clonedChild.title}`;
      }
      merged.children.attached.push(clonedChild);
    }
  }

  return merged;
}

/**
 * Upload a local file to IMA knowledge base using create_media -> cos-upload -> add_knowledge pipeline
 */
export async function uploadFileToKb(kbId, filePath, options = {}) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`文件不存在: ${filePath}`);
  }

  const stat = fs.statSync(filePath);
  const fileName = path.basename(filePath);
  const ext = path.extname(filePath).toLowerCase();

  let contentType = 'application/octet-stream';
  let mediaType = 1;

  if (ext === '.xmind') {
    contentType = 'application/vnd.xmind.workbook';
    mediaType = 14;
  } else if (ext === '.xlsx') {
    contentType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    mediaType = 5;
  } else if (ext === '.md' || ext === '.txt') {
    contentType = 'text/plain; charset=utf-8';
    mediaType = 1;
  }

  const createMediaResp = callImaApi('openapi/wiki/v1/create_media', {
    file_name: fileName,
    file_size: stat.size,
    content_type: contentType,
    knowledge_base_id: kbId,
    file_ext: ext.replace(/^\./, ''),
  });

  const mediaData = createMediaResp.data || {};
  const mediaId = mediaData.media_id;
  const cosCred = mediaData.cos_credential;

  if (!mediaId || !cosCred) {
    throw new Error(`获取上传凭证失败: ${JSON.stringify(createMediaResp)}`);
  }

  const cosScript = findCosUploadScript();
  if (!cosScript) {
    throw new Error('未找到 cos-upload.cjs。无法执行 COS 上传。');
  }

  const cosArgs = [
    cosScript,
    '--file', filePath,
    '--secret-id', cosCred.secret_id,
    '--secret-key', cosCred.secret_key,
    '--token', cosCred.token,
    '--bucket', cosCred.bucket_name,
    '--region', cosCred.region,
    '--cos-key', cosCred.cos_key,
    '--content-type', contentType,
    '--start-time', String(cosCred.start_time),
    '--expired-time', String(cosCred.expired_time),
    '--timeout', '300000',
  ];

  const uploadResult = spawnSync(process.execPath, cosArgs, {
    encoding: 'utf8',
    timeout: 300000,
  });

  if (uploadResult.status !== 0) {
    throw new Error(`COS 上传失败 (exit ${uploadResult.status}): ${uploadResult.stderr || uploadResult.stdout}`);
  }

  const addPayload = {
    media_type: mediaType,
    media_id: mediaId,
    title: fileName,
    knowledge_base_id: kbId,
    file_info: {
      cos_key: cosCred.cos_key,
      file_size: stat.size,
      file_name: fileName,
    },
  };
  if (options.folderId) {
    addPayload.folder_id = options.folderId;
  }

  const addResp = callImaApi('openapi/wiki/v1/add_knowledge', addPayload);

  return {
    success: true,
    mediaId,
    fileName,
    kbId,
    folderId: options.folderId || null,
    addResult: addResp.data || null,
  };
}

/**
 * Two-way push to IMA Knowledge Base (Supports: 'new-file' or 'merge')
 */
export async function pushBaseline(options = {}) {
  const {
    kbName,
    file,
    mode = 'new-file',
    targetMediaId = null,
    versionTag = '',
    folderId = null,
  } = options;

  if (!kbName) throw new Error('缺少 kbName 参数');
  if (!file) throw new Error('缺少 file 参数');
  if (!fs.existsSync(file)) throw new Error(`文件不存在: ${file}`);

  const kbs = await searchKnowledgeBases(kbName);
  if (!kbs.length) throw new Error(`未找到名称包含 "${kbName}" 的知识库`);
  const kbId = kbs[0].knowledge_base_id;

  if (mode === 'new-file') {
    return uploadFileToKb(kbId, file, { folderId });
  }

  if (mode === 'merge') {
    if (!targetMediaId) {
      throw new Error('合并模式 (mode: merge) 必须提供 targetMediaId');
    }

    const infoResp = callImaApi('openapi/wiki/v1/get_media_info', { media_id: targetMediaId });
    const fileUrl = infoResp?.data?.url_info?.url;
    if (!fileUrl) throw new Error(`未能获取 targetMediaId ${targetMediaId} 的下载地址`);

    const headers = {};
    if (infoResp.data.url_info.headers) {
      for (const h of infoResp.data.url_info.headers) {
        headers[h.key] = h.value;
      }
    }

    const response = await fetch(fileUrl, { headers });
    if (!response.ok) throw new Error(`下载原 XMind 失败: HTTP ${response.status}`);
    const originalBuf = Buffer.from(await response.arrayBuffer());
    const originalEntries = readZipEntries(originalBuf);
    if (!originalEntries['content.json']) {
      throw new Error('原 XMind 文件中未找到 content.json');
    }
    const originalContent = JSON.parse(originalEntries['content.json'].toString('utf8'));
    const originalSheet = Array.isArray(originalContent) ? originalContent[0] : originalContent;

    const newBuf = fs.readFileSync(file);
    const newEntries = readZipEntries(newBuf);
    if (!newEntries['content.json']) {
      throw new Error('待上传的 XMind 文件中未找到 content.json');
    }
    const newContent = JSON.parse(newEntries['content.json'].toString('utf8'));
    const newSheet = Array.isArray(newContent) ? newContent[0] : newContent;

    const mergedRootTopic = mergeTopicTrees(originalSheet.rootTopic, newSheet.rootTopic, { versionTag });
    originalSheet.rootTopic = mergedRootTopic;

    const { createZipArchive } = await import('./export-testcases.mjs');
    const mergedZip = createZipArchive({
      'content.json': JSON.stringify(Array.isArray(originalContent) ? originalContent : [originalSheet], null, 2),
      'metadata.json': '{}',
      'manifest.json': JSON.stringify({
        'file-entries': {
          'content.json': {},
          'metadata.json': {},
        },
      }),
    });

    const baseName = path.basename(file, path.extname(file));
    const mergedFileName = `${baseName}_merged.xmind`;
    const tempFilePath = path.join(os.tmpdir(), mergedFileName);
    fs.writeFileSync(tempFilePath, mergedZip);

    try {
      const result = await uploadFileToKb(kbId, tempFilePath, { folderId });
      return {
        ...result,
        mode: 'merge',
        targetMediaId,
        mergedFileName,
      };
    } finally {
      if (fs.existsSync(tempFilePath)) {
        fs.unlinkSync(tempFilePath);
      }
    }
  }

  throw new Error(`不支持的归档模式: ${mode}`);
}

// CLI handler
async function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  if (!command || command === '--help' || command === '-h') {
    process.stdout.write(`
IMA Bridge - 知识库与测试用例联动工具

用法:
  node ima-bridge.mjs search-kb <知识库名>
  node ima-bridge.mjs search <知识库名> --query <关键词>
  node ima-bridge.mjs get-media <media_id>
  node ima-bridge.mjs fetch-baseline <知识库名> --query <关键词>
  node ima-bridge.mjs diff <知识库名> --query <关键词> [--spec-file <文件>]
  node ima-bridge.mjs push <知识库名> --file <路径> [--mode new-file|merge] [--target-media-id <id>] [--version-tag <tag>]
\n`);
    return;
  }

  if (command === 'search-kb') {
    const query = args[1] || '';
    const results = await searchKnowledgeBases(query);
    process.stdout.write(`${JSON.stringify(results, null, 2)}\n`);
    return;
  }

  if (command === 'search') {
    const kbName = args[1];
    let query = '';
    for (let i = 2; i < args.length; i += 1) {
      if (args[i] === '--query' && args[i + 1]) {
        query = args[i + 1];
        break;
      }
    }
    const kbs = await searchKnowledgeBases(kbName);
    if (!kbs.length) {
      process.stderr.write(`未找到知识库 "${kbName}"\n`);
      process.exitCode = 1;
      return;
    }
    const items = await searchKnowledgeItems(kbs[0].knowledge_base_id, query);
    process.stdout.write(`${JSON.stringify(items, null, 2)}\n`);
    return;
  }

  if (command === 'get-media') {
    const mediaId = args[1];
    if (!mediaId) throw new Error('缺少 media_id 参数');
    const result = await getMediaParsedContent(mediaId);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  if (command === 'fetch-baseline') {
    const kbName = args[1];
    let query = '';
    for (let i = 2; i < args.length; i += 1) {
      if (args[i] === '--query' && args[i + 1]) {
        query = args[i + 1];
        break;
      }
    }
    const result = await fetchBaseline(kbName, query);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  if (command === 'diff') {
    const kbName = args[1];
    let query = '';
    let specFile = null;
    for (let i = 2; i < args.length; i += 1) {
      if (args[i] === '--query' && args[i + 1]) {
        query = args[i + 1];
        i += 1;
      } else if (args[i] === '--spec-file' && args[i + 1]) {
        specFile = args[i + 1];
        i += 1;
      }
    }

    const baseline = await fetchBaseline(kbName, query);
    let newSpecText = query;
    if (specFile) {
      newSpecText = fs.readFileSync(specFile, 'utf8');
    }

    const diffResult = diffBaseline(baseline, newSpecText);
    process.stdout.write(`${JSON.stringify(diffResult, null, 2)}\n`);
    return;
  }

  if (command === 'push') {
    const kbName = args[1];
    let file = null;
    let mode = 'new-file';
    let targetMediaId = null;
    let versionTag = '';
    let folderId = null;

    for (let i = 2; i < args.length; i += 1) {
      if (args[i] === '--file' && args[i + 1]) {
        file = args[i + 1];
        i += 1;
      } else if (args[i] === '--mode' && args[i + 1]) {
        mode = args[i + 1];
        i += 1;
      } else if (args[i] === '--target-media-id' && args[i + 1]) {
        targetMediaId = args[i + 1];
        i += 1;
      } else if (args[i] === '--version-tag' && args[i + 1]) {
        versionTag = args[i + 1];
        i += 1;
      } else if (args[i] === '--folder' && args[i + 1]) {
        folderId = args[i + 1];
        i += 1;
      }
    }

    const result = await pushBaseline({
      kbName,
      file,
      mode,
      targetMediaId,
      versionTag,
      folderId,
    });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  throw new Error(`不支持的指令: ${command}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((err) => {
    process.stderr.write(`${err.message}\n`);
    process.exitCode = 1;
  });
}
