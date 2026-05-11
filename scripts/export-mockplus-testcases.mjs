import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { buildModuleJson } from './build-mockplus-testcases.mjs';
import { fetchSingleUrlData, makeSafeName } from './fetch-mockplus-content.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

function parseArgs(argv) {
  const options = {
    url: null,
    shareName: null,
    outputDir: path.resolve('exports/testcases'),
    timeoutMs: 30000,
    headed: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const current = argv[i];
    const next = argv[i + 1];
    switch (current) {
      case '--url':
        if (!next) throw new Error('--url 需要传入公开分享链接');
        options.url = next;
        i += 1;
        break;
      case '--share-name':
        if (!next) throw new Error('--share-name 需要传入分享标识名');
        options.shareName = next;
        i += 1;
        break;
      case '--output-dir':
        if (!next) throw new Error('--output-dir 需要传入输出目录');
        options.outputDir = path.resolve(next);
        i += 1;
        break;
      case '--timeout-ms':
        if (!next) throw new Error('--timeout-ms 需要传入超时毫秒数');
        options.timeoutMs = Number.parseInt(next, 10);
        if (!Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0) {
          throw new Error('--timeout-ms 必须是正整数');
        }
        i += 1;
        break;
      case '--headed':
        options.headed = true;
        break;
      default:
        throw new Error(`不支持的参数：${current}`);
    }
  }

  if (!options.url) {
    throw new Error('必须提供 --url。当前只支持手动传入共享链接，不再支持 --config。');
  }

  return options;
}

function runExporter(inputJsonText, outputDir) {
  return new Promise((resolve, reject) => {
    const scriptPath = path.resolve(import.meta.dirname, 'export-testcases.ps1');
    const child = spawn('powershell', [
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      scriptPath,
      '-InputJsonText',
      inputJsonText,
      '-OutputDir',
      outputDir,
    ], {
      cwd: path.resolve(import.meta.dirname, '..'),
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve(JSON.parse(stdout));
        return;
      }
      reject(new Error(`export-testcases.ps1 exited with code ${code}\nSTDOUT:\n${stdout}\nSTDERR:\n${stderr}`));
    });
  });
}

async function exportSingleShare(browser, item, sharedOptions) {
  const shareLabel = item.name || sharedOptions.shareName || item.url;
  const shareDirectoryName = makeSafeName(shareLabel);
  const shareOutputDir = path.join(sharedOptions.outputDir, shareDirectoryName);
  const fetched = await fetchSingleUrlData(browser, item.url, sharedOptions);

  if (!fetched.success) {
    return {
      name: item.name ?? null,
      url: item.url,
      outputDir: shareOutputDir,
      success: false,
      failureCode: fetched.failureCode,
      failureReason: fetched.failureReason,
      modules: [],
    };
  }

  const moduleResults = [];
  for (const moduleEntry of fetched.modules) {
    const payload = buildModuleJson({
      module: moduleEntry.module,
      rootPage: moduleEntry.rootPage,
      secondLayerPages: moduleEntry.secondLayerPages,
      thirdLayerPages: moduleEntry.thirdLayerPages || [],
    });
    if (!payload || !Array.isArray(payload.testCases) || payload.testCases.length === 0) {
      continue;
    }
    const exported = await runExporter(JSON.stringify(payload), shareOutputDir);
    moduleResults.push(...exported.modules);
  }

  return {
    name: item.name ?? null,
    url: item.url,
    outputDir: shareOutputDir,
    success: true,
    modules: moduleResults,
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const items = [{ name: options.shareName ?? null, url: options.url }];

  await fs.mkdir(options.outputDir, { recursive: true });
  const browser = await chromium.launch({ headless: !options.headed });
  try {
    const results = [];
    for (const item of items) {
      results.push(await exportSingleShare(browser, item, options));
    }
    process.stdout.write(`${JSON.stringify({ outputDir: options.outputDir, results }, null, 2)}\n`);
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
