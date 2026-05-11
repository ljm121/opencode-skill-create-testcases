import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { spawnAsync, runPowerShell, exporterScriptPath, skillRoot } from './__test-utils__.mjs';

const fixtureRoot = path.join(skillRoot, 'fixtures', 'inputpath-fixtures');
const singleFilePath = path.join(fixtureRoot, 'single-requirement.md');
const sameDirPath = path.join(fixtureRoot, 'same-dir');

function runExportWithInputPath(inputPath, outputDir, extraArgs = []) {
  return spawnAsync('powershell', [
    '-ExecutionPolicy', 'Bypass',
    '-File', exporterScriptPath,
    '-InputPath', inputPath,
    '-OutputDir', outputDir,
    ...extraArgs,
  ]).then((result) => {
    if (result.code !== 0) {
      throw new Error(`export-testcases.ps1 exited with code ${result.code}\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`);
    }
    return { stdout: result.stdout, stderr: result.stderr };
  });
}

test('export-testcases supports single InputPath file with merged root output', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'create-testcases-inputpath-file-'));

  try {
    const { stdout } = await runExportWithInputPath(singleFilePath, tempDir);
    const result = JSON.parse(stdout);

    const entries = await fs.readdir(tempDir);
    assert.equal(entries.length, 3);

    const markdown = await fs.readFile(result.modules[0].files.markdown, 'utf8');
    assert.match(markdown, /打款方式搜索下拉调整/);
    assert.match(markdown, /搜索能力/);
    assert.match(markdown, /选项维护/);
    assert.match(markdown, /打款方式控件改为可搜索下拉单选/);
    assert.match(markdown, /新增全球雇佣新加坡-云汇选项/);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test('export-testcases supports same-directory InputPath with merged root output and preserved module grouping', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'create-testcases-inputpath-dir-'));

  try {
    const { stdout } = await runExportWithInputPath(sameDirPath, tempDir);
    const result = JSON.parse(stdout);

    const entries = await fs.readdir(tempDir);
    assert.equal(entries.length, 3);

    const markdown = await fs.readFile(result.modules[0].files.markdown, 'utf8');
    assert.match(markdown, /模块A/);
    assert.match(markdown, /列表展示/);
    assert.match(markdown, /模块B/);
    assert.match(markdown, /导出能力/);
    assert.match(markdown, /模块C/);
    assert.match(markdown, /失败反馈/);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test('export-testcases rejects using InputJson and InputPath together', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'create-testcases-inputpath-exclusive-'));

  try {
    const result = await runPowerShell([
      '-File', exporterScriptPath,
      '-InputJson', path.join(skillRoot, 'fixtures', 'mail-module', 'testcases-input.json'),
      '-InputPath', singleFilePath,
      '-OutputDir', tempDir,
    ]);

    assert.notEqual(result.code, 0);
    assert.match(`${result.stdout}\n${result.stderr}`, /cannot be used together/i);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});
