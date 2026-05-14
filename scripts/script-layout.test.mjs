import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

const scriptsDir = new URL('.', import.meta.url);
const skillRoot = new URL('../', import.meta.url);

async function exists(baseUrl, fileName) {
  try {
    await fs.access(new URL(fileName, baseUrl));
    return true;
  } catch {
    return false;
  }
}

test('deprecated intermediate-artifact CLI scripts are removed', async () => {
  const deprecated = [
    'build-screenshot-testcases.mjs',
    'build-screenshot-testcases.ps1',
    'capture-mockplus-module-screenshots.mjs',
    'capture-mockplus-module-screenshots.ps1',
    'ocr-screenshot.mjs',
    'ocr-screenshot.ps1',
    'fetch-mockplus-content.ps1',
    'build-mockplus-testcases.ps1',
    'extract-docx.ps1',
    'extract-docx2.ps1',
    'extract-docx3.ps1',
    'extract-docx4.ps1',
    'extract-final.ps1',
    'extract-补充逻辑.ps1',
    'extract-docx.mjs',
  ];

  for (const fileName of deprecated) {
    assert.equal(await exists(scriptsDir, fileName), false, `${fileName} should be removed`);
  }

  const rootArtifacts = [
    'temp_doc.docx',
    'extracted_content.txt',
    '补充逻辑-提取内容.txt',
  ];

  for (const fileName of rootArtifacts) {
    assert.equal(await exists(skillRoot, fileName), false, `${fileName} should not be generated in skill root`);
  }
});

test('current direct-export entrypoints still exist', async () => {
  const required = [
    'export-testcases.ps1',
    'export-testcases.test.mjs',
    'export-mockplus-testcases.mjs',
    'export-mockplus-testcases.ps1',
    'fetch-mockplus-content.mjs',
    'build-mockplus-testcases.mjs',
    'fetch-and-summarize-design.mjs',
    'verify-runtime.mjs',
    'setup-runtime.ps1',
  ];

  for (const fileName of required) {
    assert.equal(await exists(scriptsDir, fileName), true, `${fileName} should exist`);
  }
});
