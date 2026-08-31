#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

// ─── Pure Node.js ZIP Archive Generator (Zero Dependencies) ───

const crcTable = new Uint32Array(256);
for (let i = 0; i < 256; i += 1) {
  let c = i;
  for (let k = 0; k < 8; k += 1) {
    c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
  }
  crcTable[i] = c;
}

export function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) {
    crc = crcTable[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export function createZipArchive(files) {
  const localHeaders = [];
  const cdHeaders = [];
  let offset = 0;

  for (const [filename, content] of Object.entries(files)) {
    const rawData = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8');
    const fnBuf = Buffer.from(filename, 'utf8');
    const compressed = zlib.deflateRawSync(rawData);
    const crc = crc32(rawData);

    const lfh = Buffer.alloc(30 + fnBuf.length);
    lfh.writeUInt32LE(0x04034b50, 0);
    lfh.writeUInt16LE(20, 4);
    lfh.writeUInt16LE(0x0800, 6); // UTF-8 filename flag
    lfh.writeUInt16LE(8, 8); // Deflate
    lfh.writeUInt16LE(0, 10);
    lfh.writeUInt16LE(0, 12);
    lfh.writeUInt32LE(crc, 14);
    lfh.writeUInt32LE(compressed.length, 18);
    lfh.writeUInt32LE(rawData.length, 22);
    lfh.writeUInt16LE(fnBuf.length, 26);
    lfh.writeUInt16LE(0, 28);
    fnBuf.copy(lfh, 30);

    localHeaders.push(lfh, compressed);

    const cdh = Buffer.alloc(46 + fnBuf.length);
    cdh.writeUInt32LE(0x02014b50, 0);
    cdh.writeUInt16LE(20, 4);
    cdh.writeUInt16LE(20, 6);
    cdh.writeUInt16LE(0x0800, 8);
    cdh.writeUInt16LE(8, 10);
    cdh.writeUInt16LE(0, 12);
    cdh.writeUInt16LE(0, 14);
    cdh.writeUInt32LE(crc, 16);
    cdh.writeUInt32LE(compressed.length, 20);
    cdh.writeUInt32LE(rawData.length, 24);
    cdh.writeUInt16LE(fnBuf.length, 28);
    cdh.writeUInt16LE(0, 30);
    cdh.writeUInt16LE(0, 32);
    cdh.writeUInt16LE(0, 34);
    cdh.writeUInt16LE(0, 36);
    cdh.writeUInt32LE(0, 38);
    cdh.writeUInt32LE(offset, 42);
    fnBuf.copy(cdh, 46);

    cdHeaders.push(cdh);
    offset += lfh.length + compressed.length;
  }

  const cdBuf = Buffer.concat(cdHeaders);
  const cdOffset = offset;

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  const count = Object.keys(files).length;
  eocd.writeUInt16LE(count, 8);
  eocd.writeUInt16LE(count, 10);
  eocd.writeUInt32LE(cdBuf.length, 12);
  eocd.writeUInt32LE(cdOffset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...localHeaders, cdBuf, eocd]);
}

// ─── XML & Excel (OpenXML) Generator ───

function escapeXml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function colName(n) {
  let s = '';
  let num = n;
  while (num > 0) {
    const m = (num - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    num = Math.floor((num - m) / 26);
  }
  return s;
}

export function createXlsxBuffer(rows, sheetName = 'TestCases') {
  const sharedStrings = [];
  const stringIndexMap = new Map();

  function getSharedStringIndex(str) {
    const s = String(str ?? '');
    if (!stringIndexMap.has(s)) {
      stringIndexMap.set(s, sharedStrings.length);
      sharedStrings.push(s);
    }
    return stringIndexMap.get(s);
  }

  const sheetRows = [];
  for (let r = 0; r < rows.length; r += 1) {
    const row = rows[r];
    const cells = [];
    for (let c = 0; c < row.length; c += 1) {
      const val = row[c];
      const idx = getSharedStringIndex(val);
      const cellRef = `${colName(c + 1)}${r + 1}`;
      cells.push(`<c r="${cellRef}" t="s"><v>${idx}</v></c>`);
    }
    sheetRows.push(`<row r="${r + 1}">${cells.join('')}</row>`);
  }

  const sharedStringsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${sharedStrings.length}" uniqueCount="${sharedStrings.length}">
${sharedStrings.map((s) => `<si><t xml:space="preserve">${escapeXml(s)}</t></si>`).join('\n')}
</sst>`;

  const sheetXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetViews><sheetView workbookViewId="0"/></sheetViews>
  <sheetFormatPr defaultRowHeight="18"/>
  <sheetData>
    ${sheetRows.join('\n    ')}
  </sheetData>
</worksheet>`;

  const workbookXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>
    <sheet name="${escapeXml(sheetName)}" sheetId="1" r:id="rId1"/>
  </sheets>
</workbook>`;

  const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts>
  <fills count="1"><fill><patternFill patternType="none"/></fill></fills>
  <borders count="1"><border/></borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs>
  <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

  const contentTypesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
  <Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
  <Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
</Types>`;

  const relsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>`;

  const workbookRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/>
</Relationships>`;

  const created = new Date().toISOString();
  const coreXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <dc:title>TestCases</dc:title>
  <dc:creator>OpenCode</dc:creator>
  <cp:lastModifiedBy>OpenCode</cp:lastModifiedBy>
  <dcterms:created xsi:type="dcterms:W3CDTF">${created}</dcterms:created>
  <dcterms:modified xsi:type="dcterms:W3CDTF">${created}</dcterms:modified>
</cp:coreProperties>`;

  const appXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">
  <Application>OpenCode</Application>
</Properties>`;

  return createZipArchive({
    '[Content_Types].xml': contentTypesXml,
    '_rels/.rels': relsXml,
    'docProps/core.xml': coreXml,
    'docProps/app.xml': appXml,
    'xl/workbook.xml': workbookXml,
    'xl/_rels/workbook.xml.rels': workbookRelsXml,
    'xl/styles.xml': stylesXml,
    'xl/sharedStrings.xml': sharedStringsXml,
    'xl/worksheets/sheet1.xml': sheetXml,
  });
}

// ─── XMind Archive Generator ───

function generateGuid() {
  return crypto.randomUUID().replace(/-/g, '');
}

export function buildXmindTopic(node, isRoot = false) {
  const topic = {
    id: node.id || generateGuid(),
    title: node.title || '节点',
  };

  if (isRoot) {
    topic.class = 'topic';
    topic.structureClass = 'org.xmind.ui.logic.right';
  }

  if (node.notes?.plain?.content) {
    topic.notes = { plain: { content: node.notes.plain.content } };
  }

  const children = node.children?.attached || node.children || [];
  if (Array.isArray(children) && children.length > 0) {
    topic.children = {
      attached: children.map((c) => buildXmindTopic(c, false)),
    };
  }

  return topic;
}

export function createXmindBuffer(rootNode, sheetTitle = '画布 1') {
  const rootTopic = buildXmindTopic(rootNode, true);
  const sheet = {
    id: generateGuid(),
    class: 'sheet',
    title: sheetTitle,
    rootTopic,
  };

  const contentJson = JSON.stringify([sheet], null, 2);
  const manifestJson = JSON.stringify({
    'file-entries': {
      'content.json': {},
      'metadata.json': {},
    },
  }, null, 2);

  return createZipArchive({
    'content.json': contentJson,
    'metadata.json': '{}',
    'manifest.json': manifestJson,
  });
}

// ─── Markdown Generator ───

export function createMarkdownString(data) {
  const docSummary = data.documentSummary || {};
  const testCases = data.testCases || [];

  const lines = [
    `# ${docSummary.name || '测试用例'}`,
    '',
    '## 需求摘要',
    '',
    `- 业务范围：${docSummary.name || '-'}`,
    `- 用例总数：${testCases.length}`,
    `- 输入类型：${docSummary.type || 'requirement'}`,
    docSummary.parseResult ? `- 解析说明：${docSummary.parseResult}` : '',
    '',
    '## 测试用例明细',
    '',
    '| 用例编号 | 功能模块 | 场景分类 | 用例标题 | 测试步骤 | 预期结果 | 优先级 | 测试类型 |',
    '|---|---|---|---|---|---|---|---|',
  ];

  const prefix = data.prefix || 'TC';
  testCases.forEach((tc, idx) => {
    const id = tc.id || `${prefix}-${String(idx + 1).padStart(3, '0')}`;
    const steps = Array.isArray(tc.steps) ? tc.steps.join('<br>') : String(tc.steps || '');
    lines.push(
      `| ${id} | ${tc.module || '-'} | ${tc.scenario || '-'} | ${tc.title || '-'} | ${steps} | ${tc.expectedResult || '-'} | ${tc.priority || 'P1'} | ${tc.testType || '功能'} |`
    );
  });

  return lines.filter(Boolean).join('\n');
}

// ─── Data Tree Builders ───

export function buildXmindTreeFromPayload(payload) {
  if (payload.xmindTree) {
    return payload.xmindTree;
  }

  const docName = payload.documentSummary?.name || '测试用例';
  const root = {
    title: docName,
    children: [],
  };

  if (Array.isArray(payload.xmindOperations) && payload.xmindOperations.length > 0) {
    for (const op of payload.xmindOperations) {
      const opNode = {
        title: op.name,
        children: (op.scenarios || []).map((sc) => ({
          title: sc.name,
          children: (sc.cases || []).map((c) => ({
            title: c.title,
            children: [{ title: `步骤: ${Array.isArray(c.steps) ? c.steps.join('; ') : c.steps}` }, { title: `预期: ${c.expectedResult}` }],
          })),
        })),
      };
      root.children.push(opNode);
    }
    return root;
  }

  const moduleMap = new Map();
  for (const tc of payload.testCases || []) {
    const mod = tc.module || '通用模块';
    const sc = tc.scenario || '核心场景';
    if (!moduleMap.has(mod)) moduleMap.set(mod, new Map());
    const scMap = moduleMap.get(mod);
    if (!scMap.has(sc)) scMap.set(sc, []);
    scMap.get(sc).push(tc);
  }

  for (const [mod, scMap] of moduleMap.entries()) {
    const modNode = { title: mod, children: [] };
    for (const [sc, cases] of scMap.entries()) {
      const scNode = {
        title: sc,
        children: cases.map((c) => ({
          title: c.title,
          children: [
            { title: `步骤: ${Array.isArray(c.steps) ? c.steps.join('; ') : c.steps}` },
            { title: `预期: ${c.expectedResult}` },
          ],
        })),
      };
      modNode.children.push(scNode);
    }
    root.children.push(modNode);
  }

  return root;
}

export function buildExcelRowsFromPayload(payload) {
  const headers = ['功能模块', '场景分类', '用例标题', '测试步骤', '预期结果', '优先级', '测试类型'];
  const rows = [headers];

  for (const tc of payload.testCases || []) {
    const steps = Array.isArray(tc.steps) ? tc.steps.join('；') : String(tc.steps || '');
    rows.push([
      String(tc.module || ''),
      String(tc.scenario || ''),
      String(tc.title || ''),
      steps,
      String(tc.expectedResult || ''),
      String(tc.priority || 'P1'),
      String(tc.testType || '功能'),
    ]);
  }

  return rows;
}

// ─── Main Exporter Function ───

export async function exportTestcases(payload, options = {}) {
  const docName = payload.documentSummary?.name || '测试用例';
  const baseDir = options.outputDir
    ? path.resolve(options.outputDir)
    : path.resolve('exports', docName);

  if (options.preview) {
    return {
      success: true,
      preview: true,
      caseCount: (payload.testCases || []).length,
      docName,
      targetDir: baseDir,
    };
  }

  await fs.mkdir(baseDir, { recursive: true });

  const outputs = [];

  // 1. Markdown
  const mdPath = path.join(baseDir, `${docName}.md`);
  const mdContent = createMarkdownString(payload);
  await fs.writeFile(mdPath, mdContent, 'utf8');
  outputs.push({ type: 'markdown', path: mdPath, status: 'success' });

  // 2. Excel
  const xlsxPath = path.join(baseDir, `${docName}.xlsx`);
  const excelRows = buildExcelRowsFromPayload(payload);
  const xlsxBuffer = createXlsxBuffer(excelRows, 'TestCases');
  await fs.writeFile(xlsxPath, xlsxBuffer);
  outputs.push({ type: 'excel', path: xlsxPath, status: 'success' });

  // 3. XMind
  const xmindPath = path.join(baseDir, `${docName}.xmind`);
  const xmindTree = buildXmindTreeFromPayload(payload);
  const xmindBuffer = createXmindBuffer(xmindTree, docName);
  await fs.writeFile(xmindPath, xmindBuffer);
  outputs.push({ type: 'xmind', path: xmindPath, status: 'success' });

  return {
    success: true,
    documentName: docName,
    outputDirectory: baseDir,
    caseCount: (payload.testCases || []).length,
    outputs,
  };
}

// ─── CLI Entrypoint ───

async function main() {
  const args = process.argv.slice(2);
  const options = {
    inputJson: null,
    inputJsonText: null,
    outputDir: null,
    splitByModule: false,
    preview: false,
  };

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    const next = args[i + 1];

    if ((arg === '--input-json' || arg === '-InputJson') && next) {
      options.inputJson = next;
      i += 1;
    } else if ((arg === '--input-json-text' || arg === '-InputJsonText') && next) {
      options.inputJsonText = next;
      i += 1;
    } else if ((arg === '--output-dir' || arg === '-OutputDir') && next) {
      options.outputDir = next;
      i += 1;
    } else if (arg === '--split-by-module' || arg === '-SplitByModule') {
      options.splitByModule = true;
    } else if (arg === '--preview' || arg === '-Preview') {
      options.preview = true;
    }
  }

  let payload = null;
  if (options.inputJsonText) {
    payload = JSON.parse(options.inputJsonText);
  } else if (options.inputJson) {
    const raw = await fs.readFile(path.resolve(options.inputJson), 'utf8');
    payload = JSON.parse(raw);
  } else {
    throw new Error('必须提供 --input-json 或 --input-json-text 参数');
  }

  const result = await exportTestcases(payload, options);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((err) => {
    process.stderr.write(JSON.stringify({ success: false, error: err.message }) + '\n');
    process.exitCode = 1;
  });
}
