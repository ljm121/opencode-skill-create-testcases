import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(scriptDir, '..');

async function checkPackageJson() {
  const packagePath = path.join(skillRoot, 'package.json');
  try {
    const raw = await fs.readFile(packagePath, 'utf8');
    const parsed = JSON.parse(raw);
    return {
      name: 'package.json',
      ok: Boolean(parsed?.dependencies?.playwright),
      message: parsed?.dependencies?.playwright
        ? undefined
        : 'package.json 中缺少 playwright 依赖声明',
    };
  } catch (error) {
    return {
      name: 'package.json',
      ok: false,
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

function checkPlaywrightModule() {
  try {
    const playwright = require('playwright');
    return {
      name: 'playwright-module',
      ok: Boolean(playwright?.chromium),
      message: playwright?.chromium ? undefined : 'playwright 已加载，但 chromium 不可用',
    };
  } catch (error) {
    return {
      name: 'playwright-module',
      ok: false,
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

async function checkChromiumLaunch() {
  try {
    const { chromium } = require('playwright');
    const browser = await chromium.launch({ headless: true });
    await browser.close();
    return { name: 'playwright-chromium', ok: true };
  } catch (error) {
    return {
      name: 'playwright-chromium',
      ok: false,
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

async function verifyRuntime() {
  const checks = [];
  checks.push(await checkPackageJson());

  const playwrightCheck = checkPlaywrightModule();
  checks.push(playwrightCheck);

  if (playwrightCheck.ok) {
    checks.push(await checkChromiumLaunch());
  } else {
    checks.push({
      name: 'playwright-chromium',
      ok: false,
      message: '由于 playwright 模块不可用，跳过 Chromium 启动检查',
    });
  }

  return {
    ok: checks.every((item) => item.ok),
    skillRoot,
    checks,
  };
}

async function main() {
  const result = await verifyRuntime();
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (!result.ok) {
    process.exitCode = 1;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}

export { verifyRuntime };
