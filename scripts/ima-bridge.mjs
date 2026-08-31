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

  throw new Error(`不支持的指令: ${command}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((err) => {
    process.stderr.write(`${err.message}\n`);
    process.exitCode = 1;
  });
}
