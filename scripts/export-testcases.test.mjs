import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { runPowerShell, runExportToDir, readZipEntry, runExportPowerShellCommand, spawnAsync, skillRoot, exporterScriptPath } from './__test-utils__.mjs';

const sampleInputPath = path.join(skillRoot, 'fixtures', 'mail-module', 'testcases-input.json');
const sampleInput = JSON.parse(await fs.readFile(sampleInputPath, 'utf8'));
const moduleName = sampleInput.testCases[0].module;
const mergedInputPath = path.join(skillRoot, 'fixtures', 'test-md-current', 'testcases-input.json');
const xmindTreeInputPath = path.join(skillRoot, 'fixtures', 'xmind-tree-style', 'testcases-input.json');
const xmindOperationsInputPath = path.join(skillRoot, 'fixtures', 'xmind-operation-template', 'testcases-input.json');

function runExport(outputDir, mode = 'path', extraArgs = []) {
  if (mode === 'path') {
    return runExportCommand([
      '-ExecutionPolicy', 'Bypass',
      '-File', exporterScriptPath,
      '-InputJson', sampleInputPath,
      '-OutputDir', outputDir,
      ...extraArgs,
    ]);
  }
  return runExportToDir(JSON.stringify(sampleInput), outputDir, extraArgs);
}

function runMergedExport(outputDir, extraArgs = []) {
  return runExportCommand([
    '-ExecutionPolicy', 'Bypass',
    '-File', exporterScriptPath,
    '-InputJson', mergedInputPath,
    '-OutputDir', outputDir,
    ...extraArgs,
  ]);
}

function runExportCommand(args) {
  return spawnAsync('powershell', args).then((result) => {
    if (result.code !== 0) {
      throw new Error(`export-testcases.ps1 exited with code ${result.code}\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`);
    }
    return { stdout: result.stdout, stderr: result.stderr };
  });
}

function runExportWithInputPath(inputPath, outputDir, extraArgs = []) {
  return runExportCommand([
    '-ExecutionPolicy', 'Bypass',
    '-File', exporterScriptPath,
    '-InputPath', inputPath,
    '-OutputDir', outputDir,
    ...extraArgs,
  ]);
}
function collectXmindTitles(content) {
  const sheets = JSON.parse(content);
  const titles = [];
  const visit = topic => {
    if (!topic) return;
    if (topic.title) titles.push(topic.title);
    for (const child of topic.children?.attached ?? []) visit(child);
  };
  for (const sheet of sheets) visit(sheet.rootTopic);
  return titles;
}

async function writeMinimalDocx(docxPath, documentXml) {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'create-testcases-docx-src-'));

  try {
    const wordDir = path.join(tempRoot, 'word');
    await fs.mkdir(wordDir, { recursive: true });
    await fs.writeFile(path.join(wordDir, 'document.xml'), documentXml, 'utf8');

    const escapedSource = tempRoot.replace(/'/g, "''");
    const escapedTarget = docxPath.replace(/'/g, "''");
    const escapedZipTarget = `${docxPath}.zip`.replace(/'/g, "''");
    const command = [
      'Add-Type -AssemblyName System.IO.Compression.FileSystem',
      `$source = '${escapedSource}'`,
      `$target = '${escapedTarget}'`,
      `$zipTarget = '${escapedZipTarget}'`,
      "if (Test-Path -LiteralPath $target) { Remove-Item -LiteralPath $target -Force }",
      "if (Test-Path -LiteralPath $zipTarget) { Remove-Item -LiteralPath $zipTarget -Force }",
      "[System.IO.Compression.ZipFile]::CreateFromDirectory($source, $zipTarget)",
      "[System.IO.File]::Move($zipTarget, $target)",
    ].join('; ');

    const result = await runExportPowerShellCommand(command);
    if (result.code !== 0) throw new Error(`writeMinimalDocx failed:\n${result.stdout}\n${result.stderr}`);
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
}

test('export-testcases writes merged artifacts with business-scope filenames', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'create-testcases-export-'));

  try {
    const { stdout } = await runExport(tempDir);
    const result = JSON.parse(stdout);
    const entries = await fs.readdir(tempDir);

    assert.equal(entries.length, 3);
    assert.ok(entries.some(e => e.endsWith('.md')));
    assert.ok(entries.some(e => e.endsWith('.xlsx')));
    assert.ok(entries.some(e => e.endsWith('.xmind')));

    for (const mod of result.modules) {
      for (const filePath of Object.values(mod.files)) {
        await fs.access(filePath);
      }
    }
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test('export-testcases accepts inline json text with merged output', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'create-testcases-export-inline-'));

  try {
    const { stdout } = await runExport(tempDir, 'text');
    const result = JSON.parse(stdout);
    const entries = await fs.readdir(tempDir);

    assert.equal(entries.length, 3);
    assert.ok(entries.some(e => e.endsWith('.md')));
    assert.ok(entries.some(e => e.endsWith('.xlsx')));
    assert.ok(entries.some(e => e.endsWith('.xmind')));

    for (const mod of result.modules) {
      for (const filePath of Object.values(mod.files)) {
        await fs.access(filePath);
      }
    }
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test('export-testcases keeps 功能模块和测试步骤 and removes unwanted fields across outputs', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'create-testcases-export-shape-'));

  try {
    const { stdout } = await runExport(tempDir);
    const result = JSON.parse(stdout);
    const mdFile = result.modules[0].files.markdown;
    const xlsxFile = result.modules[0].files.excel;
    const xmindFile = result.modules[0].files.xmind;

    const markdown = await fs.readFile(mdFile, 'utf8');
    const excelStrings = await readZipEntry(xlsxFile, 'xl/sharedStrings.xml');
    const xmindContent = await readZipEntry(xmindFile, 'content.json');

    assert.match(markdown, /功能模块/);
    assert.doesNotMatch(markdown, /用例编号/);
    assert.doesNotMatch(markdown, /前置条件/);
    assert.match(markdown, /测试步骤/);
    assert.doesNotMatch(markdown, /备注/);

    assert.match(excelStrings, /功能模块/);
    assert.match(excelStrings, /测试步骤/);
    assert.doesNotMatch(excelStrings, /用例编号/);
    assert.doesNotMatch(excelStrings, /前置条件/);
    assert.doesNotMatch(excelStrings, /备注/);

    assert.match(xmindContent, /邮件签约通知/);
    assert.match(xmindContent, /点击后/);
    assert.doesNotMatch(xmindContent, /测试步骤：/);
    assert.doesNotMatch(xmindContent, /预期结果：/);
    assert.doesNotMatch(xmindContent, /优先级：/);
    assert.doesNotMatch(xmindContent, /测试类型：/);
    assert.doesNotMatch(xmindContent, /用例编号：/);
    assert.doesNotMatch(xmindContent, /前置条件：/);
    assert.doesNotMatch(xmindContent, /备注：/);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test('export-testcases writes readable business-tree xmind from explicit xmindTree', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'create-testcases-export-xmind-tree-'));

  try {
    const { stdout } = await runExportCommand([
      '-ExecutionPolicy', 'Bypass',
      '-File', exporterScriptPath,
      '-InputJson', xmindTreeInputPath,
      '-OutputDir', tempDir,
    ]);
    const result = JSON.parse(stdout);
    const xmindContent = await readZipEntry(result.modules[0].files.xmind, 'content.json');

    assert.match(xmindContent, /登录业务树样例/);
    assert.match(xmindContent, /入口/);
    assert.match(xmindContent, /点击后/);
    assert.match(xmindContent, /校验账号和密码/);
    assert.match(xmindContent, /数据落点/);
    assert.match(xmindContent, /字符串叶子节点/);
    assert.doesNotMatch(xmindContent, /未命名节点/);
    assert.doesNotMatch(xmindContent, /测试步骤：/);
    assert.doesNotMatch(xmindContent, /预期结果：/);
    assert.doesNotMatch(xmindContent, /优先级：/);
    assert.doesNotMatch(xmindContent, /测试类型：/);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});
test('export-testcases writes operation-template xmind from xmindOperations', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'create-testcases-export-xmind-operations-'));

  try {
    const { stdout } = await runExportCommand([
      '-ExecutionPolicy', 'Bypass',
      '-File', exporterScriptPath,
      '-InputJson', xmindOperationsInputPath,
      '-OutputDir', tempDir,
    ]);
    const result = JSON.parse(stdout);
    const xmindContent = await readZipEntry(result.modules[0].files.xmind, 'content.json');
    const titles = collectXmindTitles(xmindContent);

    for (const expected of ['列表', '新增', '编辑', '删除', '详情', '手机号', '保存', '筛选规则', '填写规则', '点击按钮后的校验', '数据校验']) {
      assert.ok(titles.includes(expected), `missing XMind title: ${expected}`);
    }

    assert.ok(!titles.some(title => /[\[\]{}]/.test(title)), 'operation-template output should not keep [] or {} placeholders');
    assert.match(xmindContent, /联系人管理操作模板样例/);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});
test('export-testcases merges by default and preserves module grouping', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'create-testcases-export-merged-'));

  try {
    const { stdout } = await runMergedExport(tempDir);
    const result = JSON.parse(stdout);

    const mdFile = result.modules[0].files.markdown;
    const xlsxFile = result.modules[0].files.excel;
    const xmindFile = result.modules[0].files.xmind;

    const markdown = await fs.readFile(mdFile, 'utf8');
    const excelStrings = await readZipEntry(xlsxFile, 'xl/sharedStrings.xml');
    const xmindContent = await readZipEntry(xmindFile, 'content.json');

    assert.match(markdown, /自营请款手续费统计/);
    assert.match(markdown, /承包商请款手续费分摊/);
    assert.match(excelStrings, /自营请款手续费统计/);
    assert.match(excelStrings, /承包商请款手续费分摊/);
    assert.match(xmindContent, /自营请款手续费统计/);
    assert.match(xmindContent, /承包商请款手续费分摊/);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test('export-testcases can split by module with -SplitByModule flag', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'create-testcases-export-split-'));

  try {
    const { stdout } = await runExport(tempDir, 'path', ['-SplitByModule']);
    const result = JSON.parse(stdout);

    // Each module gets its own subdirectory
    assert.ok(result.modules.length >= 1);
    const moduleDir = path.join(tempDir, moduleName);
    const entries = await fs.readdir(moduleDir);

    assert.deepEqual(entries.sort(), [
      'testcases.md',
      'testcases.xlsx',
      'testcases.xmind',
    ]);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test('export-testcases accepts InputPath for a markdown file', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'create-testcases-export-inputpath-file-'));
  const docPath = path.join(tempDir, '邮件签约通知需求.md');
  const outputDir = path.join(tempDir, 'out');

  try {
    await fs.writeFile(docPath, [
      '# 邮件签约通知',
      '',
      '## 需求说明',
      '',
      '- 签约邮箱必填。',
      '- 保存成功后显示提示。',
      '- 点击发送时需要校验邮箱格式。',
    ].join('\n'), 'utf8');

    const { stdout } = await runExportWithInputPath(docPath, outputDir);
    const result = JSON.parse(stdout);

    const entries = await fs.readdir(outputDir);
    assert.equal(entries.length, 3);

    const markdown = await fs.readFile(result.modules[0].files.markdown, 'utf8');
    assert.match(markdown, /邮件签约通知/);
    assert.match(markdown, /需求说明/);
    assert.match(markdown, /签约邮箱必填/);
    assert.match(markdown, /点击发送时需要校验邮箱格式/);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test('export-testcases merges supported files from a directory InputPath', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'create-testcases-export-inputpath-dir-'));
  const inputDir = path.join(tempDir, 'reqs');
  const outputDir = path.join(tempDir, 'out');

  try {
    await fs.mkdir(inputDir, { recursive: true });
    await fs.writeFile(path.join(inputDir, '自营请款.txt'), '自营请款按交易时间统计手续费。', 'utf8');
    await fs.writeFile(path.join(inputDir, '承包商请款.html'), '<html><body><h1>承包商请款</h1><p>按候选项目未匹配人数分摊手续费。</p></body></html>', 'utf8');

    const { stdout } = await runExportWithInputPath(inputDir, outputDir);
    const result = JSON.parse(stdout);

    const entries = await fs.readdir(outputDir);
    assert.equal(entries.length, 3);

    const markdown = await fs.readFile(result.modules[0].files.markdown, 'utf8');
    assert.match(markdown, /自营请款/);
    assert.match(markdown, /承包商请款/);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test('export-testcases accepts InputPath for a docx file', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'create-testcases-export-inputpath-docx-'));
  const docxPath = path.join(tempDir, 'payment-approval.docx');
  const outputDir = path.join(tempDir, 'out');

  try {
    await writeMinimalDocx(docxPath, [
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">',
       '  <w:body>',
       '    <w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>付款审批</w:t></w:r></w:p>',
       '    <w:p><w:pPr><w:pStyle w:val="Heading2"/></w:pPr><w:r><w:t>表单校验</w:t></w:r></w:p>',
       '    <w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>审批金额不能为空。</w:t></w:r></w:p>',
       '    <w:p><w:pPr><w:pStyle w:val="Heading2"/></w:pPr><w:r><w:t>提交流程</w:t></w:r></w:p>',
       '    <w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>提交后显示审批成功提示。</w:t></w:r></w:p>',
       '    <w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>付款复核</w:t></w:r></w:p>',
       '    <w:p><w:pPr><w:pStyle w:val="Heading2"/></w:pPr><w:r><w:t>结果展示</w:t></w:r></w:p>',
       '    <w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>复核通过后展示付款完成状态。</w:t></w:r></w:p>',
       '  </w:body>',
       '</w:document>',
      ].join('\n'));

    const { stdout } = await runExportWithInputPath(docxPath, outputDir);
    const result = JSON.parse(stdout);

    const markdown = await fs.readFile(result.modules[0].files.markdown, 'utf8');
    assert.match(markdown, /付款审批/);
    assert.match(markdown, /表单校验/);
    assert.match(markdown, /审批金额不能为空/);
    assert.match(markdown, /付款复核/);
    assert.match(markdown, /结果展示/);
    assert.match(markdown, /复核通过后展示付款完成状态/);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test('export-testcases rejects InputPath combined with InputJson', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'create-testcases-export-inputpath-conflict-'));
  const docPath = path.join(tempDir, '需求.txt');

  try {
    await fs.writeFile(docPath, '示例需求', 'utf8');

    await assert.rejects(
      runExportCommand([
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        exporterScriptPath,
        '-InputPath',
        docPath,
        '-InputJson',
        sampleInputPath,
        '-OutputDir',
        path.join(tempDir, 'out'),
      ]),
      /cannot be used together|cannot use together|只能/, 
    );
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test('preview mode outputs summary without writing files', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'preview-test-'));
  try {
    const { stdout } = await runExport(tmpDir, 'json', ['-Preview']);
    const result = JSON.parse(stdout);
    assert.equal(result.preview, true);
    assert.ok(result.modules);
    assert.ok(result.totalTestCases > 0);
    assert.ok(result.risks);
    assert.ok(result.openQuestions);
    const files = await fs.readdir(tmpDir).catch(() => []);
    assert.equal(files.length, 0);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('export-testcases rejects unsupported InputPath extension', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'create-testcases-export-inputpath-unsupported-'));
  const unsupportedPath = path.join(tempDir, '需求.csv');

  try {
    await fs.writeFile(unsupportedPath, 'a,b,c', 'utf8');

    await assert.rejects(
      runExportWithInputPath(unsupportedPath, path.join(tempDir, 'out')),
      /unsupported|不支持/,
    );
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test('InputUrl alone prints agent bridging guidance', async () => {
  const { stdout } = await runExportCommand([
    '-ExecutionPolicy', 'Bypass',
    '-File', exporterScriptPath,
    '-InputUrl', 'https://example.com/prd',
    '-OutputDir', os.tmpdir(),
  ]);

  assert.match(stdout, /webfetch|websearch/);
  assert.match(stdout, /InputJsonText/);
  assert.match(stdout, /bridging|bridge/i);
});

test('InputUrl with InputJsonText exports successfully and records source', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'create-testcases-export-url-json-'));

  try {
    const testUrl = 'https://example.com/prd';
    const { stdout } = await runExportCommand([
      '-ExecutionPolicy', 'Bypass',
      '-File', exporterScriptPath,
      '-InputUrl', testUrl,
      '-InputJsonText', JSON.stringify(sampleInput),
      '-OutputDir', tempDir,
    ]);

    const result = JSON.parse(stdout);
    assert.match(result.inputJson, new RegExp(testUrl));

    const entries = await fs.readdir(tempDir);
    assert.equal(entries.length, 3);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test('InputUrl rejects combined with InputPath', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'create-testcases-url-reject-inputpath-'));

  try {
    const docPath = path.join(tempDir, '需求.txt');
    await fs.writeFile(docPath, '示例需求', 'utf8');

    await assert.rejects(
      runExportCommand([
        '-ExecutionPolicy', 'Bypass',
        '-File', exporterScriptPath,
        '-InputUrl', 'https://example.com/prd',
        '-InputPath', docPath,
        '-OutputDir', path.join(tempDir, 'out'),
      ]),
      /cannot be used together|can only be paired/,
    );
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test('InputUrl rejects combined with InputJson', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'create-testcases-url-reject-inputjson-'));

  try {
    await assert.rejects(
      runExportCommand([
        '-ExecutionPolicy', 'Bypass',
        '-File', exporterScriptPath,
        '-InputUrl', 'https://example.com/prd',
        '-InputJson', sampleInputPath,
        '-OutputDir', path.join(tempDir, 'out'),
      ]),
      /cannot be used together|can only be paired/,
    );
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});


