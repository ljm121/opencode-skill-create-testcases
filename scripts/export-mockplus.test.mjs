import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { buildModuleJson } from './build-mockplus-testcases.mjs';
import { spawnAsync, runExportToDir, skillRoot } from './__test-utils__.mjs';

const mockplusPs1Path = path.join(skillRoot, 'scripts', 'export-mockplus-testcases.ps1');
const mockplusMjsPath = path.join(skillRoot, 'scripts', 'export-mockplus-testcases.mjs');
const fixtureRoot = path.join(skillRoot, 'fixtures', 'mockplus-fixtures');

async function readFixture(name) {
  const raw = await fs.readFile(path.join(fixtureRoot, name), 'utf8');
  return JSON.parse(raw);
}

function runExporter(inputJsonText, outputDir, extraArgs = []) {
  return runExportToDir(inputJsonText, outputDir, extraArgs).then((result) => {
    if (result.code !== 0) {
      throw new Error(`export-testcases.ps1 exited with code ${result.code}\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`);
    }
    return { stdout: result.stdout, stderr: result.stderr };
  });
}

function runProcess(command, args) {
  return spawnAsync(command, args);
}

test('mockplus node entry rejects config input', async () => {
  const result = await runProcess('node', [mockplusMjsPath, '--config', 'mockplus-links.json']);
  const output = `${result.stdout}${result.stderr}`;

  assert.notEqual(result.code, 0);
  assert.match(output, /只支持手动传入共享链接|不支持.*config|不再支持.*config/);
});

test('mockplus powershell entry rejects config input', async () => {
  const result = await runProcess('powershell', [
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    mockplusPs1Path,
    '-Config',
    'mockplus-links.json',
  ]);
  const output = `${result.stdout}${result.stderr}`;

  assert.notEqual(result.code, 0);
  assert.match(output, /只支持手动传入共享链接|不支持.*Config|不再支持.*Config|NamedParameterNotFound|matches parameter name 'Config'/);
});

test('mockplus notification fixture exports top-description scenarios end-to-end', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'create-testcases-mockplus-notification-'));

  try {
    const raw = await readFixture('notification-page.json');
    const payload = buildModuleJson(raw);

    const { stdout } = await runExporter(JSON.stringify(payload), tempDir);
    const result = JSON.parse(stdout);

    const entries = await fs.readdir(tempDir);
    assert.equal(entries.length, 3);

    const markdown = await fs.readFile(result.modules[0].files.markdown, 'utf8');
    assert.match(markdown, /企业邀请承包商签约合同/);
    assert.match(markdown, /承包商合同即将到期/);
    assert.match(markdown, /发送签约邀请通知/);
    assert.match(markdown, /发送到期提醒通知/);
    assert.doesNotMatch(markdown, /页面展示/);
    assert.doesNotMatch(markdown, /正文说明/);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test('mockplus generic fixture exports generic page scenarios end-to-end', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'create-testcases-mockplus-generic-'));

  try {
    const raw = await readFixture('generic-page.json');
    const payload = buildModuleJson(raw);

    const { stdout } = await runExporter(JSON.stringify(payload), tempDir);
    const result = JSON.parse(stdout);

    const entries = await fs.readdir(tempDir);
    assert.equal(entries.length, 3);

    const markdown = await fs.readFile(result.modules[0].files.markdown, 'utf8');
    assert.match(markdown, /字段展示/);
    assert.match(markdown, /操作入口/);
    assert.doesNotMatch(markdown, /发送对应通知内容/);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test('mockplus merged payload exports one file set while preserving both module groups', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'create-testcases-mockplus-merged-'));

  try {
    const notificationPayload = buildModuleJson(await readFixture('notification-page.json'));
    const genericPayload = buildModuleJson(await readFixture('generic-page.json'));
    const mergedPayload = {
      prefix: 'MIXED',
      documentSummary: {
        name: 'Mockplus Fixture Mixed Export',
        type: 'mockplus-fixture',
        parseResult: 'Merged notification and generic module fixtures.',
        missingInfo: 'Fixture only for regression verification.',
      },
      requirementSummary: [...notificationPayload.requirementSummary, ...genericPayload.requirementSummary],
      openQuestions: [...notificationPayload.openQuestions, ...genericPayload.openQuestions],
      testScope: [...notificationPayload.testScope, ...genericPayload.testScope],
      risks: [...notificationPayload.risks, ...genericPayload.risks],
      testCases: [...notificationPayload.testCases, ...genericPayload.testCases],
    };

    const { stdout } = await runExporter(JSON.stringify(mergedPayload), tempDir);
    const result = JSON.parse(stdout);

    const entries = await fs.readdir(tempDir);
    assert.equal(entries.length, 3);

    const markdown = await fs.readFile(result.modules[0].files.markdown, 'utf8');
    assert.match(markdown, /邮件通知中心/);
    assert.match(markdown, /客户管理/);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});
