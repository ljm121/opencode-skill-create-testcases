import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const SUPPORTED_ACTIONS = new Set([
  'goto',
  'click',
  'clickText',
  'fill',
  'select',
  'expectText',
  'expectUrl',
  'expectVisible',
]);

function parseArgs(argv) {
  const options = {
    inputJson: null,
    inputJsonText: null,
    baseUrl: null,
    outputDir: path.resolve('exports/web-test-runs'),
    authConfig: null,
    headed: false,
    timeoutMs: 10000,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];
    const next = argv[index + 1];
    switch (current) {
      case '--input-json':
        if (!next) throw new Error('--input-json requires a file path');
        options.inputJson = next;
        index += 1;
        break;
      case '--input-json-text':
        if (!next) throw new Error('--input-json-text requires JSON text');
        options.inputJsonText = next;
        index += 1;
        break;
      case '--base-url':
        if (!next) throw new Error('--base-url requires a URL');
        options.baseUrl = next;
        index += 1;
        break;
      case '--output-dir':
        if (!next) throw new Error('--output-dir requires a directory path');
        options.outputDir = path.resolve(next);
        index += 1;
        break;
      case '--auth-config':
        if (!next) throw new Error('--auth-config requires a file path');
        options.authConfig = next;
        index += 1;
        break;
      case '--timeout-ms':
        if (!next) throw new Error('--timeout-ms requires a positive integer');
        options.timeoutMs = Number.parseInt(next, 10);
        if (!Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0) {
          throw new Error('--timeout-ms must be a positive integer');
        }
        index += 1;
        break;
      case '--headed':
        options.headed = true;
        break;
      default:
        throw new Error(`Unsupported argument: ${current}`);
    }
  }

  if (!options.baseUrl) {
    throw new Error('--base-url is required');
  }

  const inputCount = [options.inputJson, options.inputJsonText].filter(Boolean).length;
  if (inputCount !== 1) {
    throw new Error('Exactly one of --input-json or --input-json-text is required');
  }

  return options;
}

async function loadTestcaseData(options) {
  const rawJson = options.inputJson
    ? await fs.readFile(options.inputJson, 'utf8')
    : options.inputJsonText;
  const data = JSON.parse(rawJson);
  if (!Array.isArray(data.testCases)) {
    throw new Error('Input JSON must contain a testCases array');
  }
  return data;
}

async function loadAuthConfig(authConfigPath) {
  if (!authConfigPath) return null;
  const config = JSON.parse(await fs.readFile(authConfigPath, 'utf8'));
  validateAuthConfig(config);
  return config;
}

function validateAuthConfig(config) {
  const requiredFields = [
    'loginPath',
    'usernameSelector',
    'passwordSelector',
    'submitSelector',
    'successSelector',
  ];
  const missing = requiredFields.filter((field) => !config || typeof config[field] !== 'string' || config[field].trim() === '');
  if (missing.length > 0) {
    throw new Error(`auth config missing required field(s): ${missing.join(', ')}`);
  }
}

function normalizePathOrUrl(baseUrl, value) {
  if (!value) return baseUrl;
  return new URL(value, baseUrl).toString();
}

function getCaseId(testcase, index) {
  return String(testcase.id || testcase.caseId || `WEB-${String(index + 1).padStart(3, '0')}`);
}

function getHint(testcase) {
  return testcase.executionHint && typeof testcase.executionHint === 'object'
    ? testcase.executionHint
    : {};
}

function normalizeExplicitAction(action) {
  if (!action || typeof action !== 'object') {
    return { manual: true, reason: 'executionHint action must be an object' };
  }
  if (!SUPPORTED_ACTIONS.has(action.type)) {
    return { manual: true, reason: `unsupported action type: ${action.type || '<empty>'}` };
  }
  return { ...action };
}

function extractQuotedText(text) {
  if (!text) return null;
  const match = String(text).match(/[“"']([^“"']+)[”"']/);
  return match ? match[1].trim() : null;
}

function extractAfterKeyword(text, keywordPattern) {
  const match = String(text || '').match(keywordPattern);
  return match && match[1] ? match[1].trim().replace(/[。；;，,]$/u, '') : null;
}

function inferActionFromStep(step, testcase, stepIndex) {
  const hint = getHint(testcase);
  const text = String(step || '').trim();
  if (!text) {
    return { manual: true, step, reason: 'empty step' };
  }

  if (/^(打开|进入|访问)/u.test(text)) {
    const target = hint.path || hint.pagePath || hint.url;
    if (target) return { type: 'goto', path: target, sourceStep: text };
    if (stepIndex === 0) return { type: 'goto', path: '/', sourceStep: text };
  }

  if (/(点击|单击)/u.test(text)) {
    if (hint.clickSelector) return { type: 'click', selector: hint.clickSelector, sourceStep: text };
    const textTarget = extractQuotedText(text) || extractAfterKeyword(text, /(?:点击|单击)\s*([^，,。；;]+)/u);
    if (textTarget) return { type: 'clickText', text: textTarget, sourceStep: text };
  }

  if (/(输入|填写)/u.test(text)) {
    if (hint.inputSelector && Object.hasOwn(hint, 'inputValue')) {
      return { type: 'fill', selector: hint.inputSelector, value: String(hint.inputValue), sourceStep: text };
    }
  }

  if (/选择/u.test(text)) {
    if (hint.selectSelector && Object.hasOwn(hint, 'selectValue')) {
      return { type: 'select', selector: hint.selectSelector, value: String(hint.selectValue), sourceStep: text };
    }
  }

  if (/(查看|检查|校验|验证|应显示|显示)/u.test(text)) {
    if (hint.expectedText) return { type: 'expectText', text: String(hint.expectedText), sourceStep: text };
    if (hint.expectedSelector) return { type: 'expectVisible', selector: hint.expectedSelector, sourceStep: text };
    if (hint.expectedUrl) return { type: 'expectUrl', value: String(hint.expectedUrl), sourceStep: text };
    const quoted = extractQuotedText(text);
    if (quoted) return { type: 'expectText', text: quoted, sourceStep: text };
  }

  return { manual: true, step: text, reason: 'step cannot be converted with current hints' };
}

function buildExecutionPlan(testcase, index) {
  const hint = getHint(testcase);
  const title = String(testcase.title || `Untitled case ${index + 1}`);
  const result = {
    id: getCaseId(testcase, index),
    title,
    actions: [],
    manualSteps: [],
    manualRequired: Boolean(testcase.manualRequired),
  };

  if (Array.isArray(hint.actions)) {
    for (const action of hint.actions) {
      const normalized = normalizeExplicitAction(action);
      if (normalized.manual) {
        result.manualSteps.push({ step: action, reason: normalized.reason });
      } else {
        result.actions.push(normalized);
      }
    }
    result.manualRequired = result.manualRequired || result.manualSteps.length > 0;
    return result;
  }

  const steps = Array.isArray(testcase.steps) ? testcase.steps : [];
  if ((hint.path || hint.pagePath || hint.url) && !steps.some((step) => /^(打开|进入|访问)/u.test(String(step)))) {
    result.actions.push({ type: 'goto', path: hint.path || hint.pagePath || hint.url, sourceStep: 'executionHint.path' });
  }

  steps.forEach((step, stepIndex) => {
    const action = inferActionFromStep(step, testcase, stepIndex);
    if (action.manual) {
      result.manualSteps.push(action);
    } else {
      result.actions.push(action);
    }
  });

  result.manualRequired = result.manualRequired || result.manualSteps.length > 0 || result.actions.length === 0;
  return result;
}

async function performLogin(page, baseUrl, authConfig, timeoutMs) {
  if (!authConfig) return;

  const username = process.env.TEST_USERNAME;
  const password = process.env.TEST_PASSWORD;
  if (!username || !password) {
    throw new Error('TEST_USERNAME and TEST_PASSWORD environment variables are required when --auth-config is used');
  }

  await page.goto(normalizePathOrUrl(baseUrl, authConfig.loginPath), { waitUntil: 'domcontentloaded' });
  await page.fill(authConfig.usernameSelector, username);
  await page.fill(authConfig.passwordSelector, password);
  await Promise.all([
    page.waitForSelector(authConfig.successSelector, { timeout: timeoutMs }),
    page.click(authConfig.submitSelector),
  ]);
}

async function runAction(page, baseUrl, action, timeoutMs) {
  switch (action.type) {
    case 'goto':
      await page.goto(normalizePathOrUrl(baseUrl, action.url || action.path || '/'), { waitUntil: 'domcontentloaded' });
      break;
    case 'click':
      await page.click(action.selector, { timeout: timeoutMs });
      break;
    case 'clickText':
      await page.getByText(action.text, { exact: true }).click({ timeout: timeoutMs });
      break;
    case 'fill':
      await page.fill(action.selector, String(action.value ?? ''), { timeout: timeoutMs });
      break;
    case 'select':
      await page.selectOption(action.selector, String(action.value ?? ''), { timeout: timeoutMs });
      break;
    case 'expectText':
      await page.getByText(action.text, { exact: action.exact !== false }).waitFor({ timeout: timeoutMs });
      break;
    case 'expectUrl':
      if (!page.url().includes(action.value)) {
        throw new Error(`expected URL to include "${action.value}", got "${page.url()}"`);
      }
      break;
    case 'expectVisible':
      await page.waitForSelector(action.selector, { state: 'visible', timeout: timeoutMs });
      break;
    default:
      throw new Error(`unsupported action type: ${action.type}`);
  }
}

function makeSafeFilePart(value) {
  return String(value || 'case')
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '_')
    .replace(/\s+/g, '_')
    .slice(0, 80);
}

async function runOneCase(context, testcase, plan, options) {
  const page = await context.newPage();
  const result = {
    id: plan.id,
    title: plan.title,
    status: 'skipped',
    actionCount: plan.actions.length,
    manualRequired: plan.manualRequired,
    manualSteps: plan.manualSteps,
    error: null,
    screenshot: null,
    trace: null,
  };

  if (plan.manualRequired && plan.actions.length === 0) {
    await page.close();
    result.status = 'manualRequired';
    return result;
  }

  const artifactBase = makeSafeFilePart(plan.id);
  const tracePath = path.join(options.outputDir, `${artifactBase}-trace.zip`);
  await context.tracing.start({ screenshots: true, snapshots: true });
  try {
    for (const action of plan.actions) {
      await runAction(page, options.baseUrl, action, options.timeoutMs);
    }
    result.status = plan.manualRequired ? 'manualRequired' : 'passed';
    if (plan.manualRequired) {
      await context.tracing.stop({ path: tracePath });
      result.trace = tracePath;
    } else {
      await context.tracing.stop();
    }
  } catch (error) {
    result.status = 'failed';
    result.error = error instanceof Error ? error.message : String(error);
    const screenshotPath = path.join(options.outputDir, `${artifactBase}-failure.png`);
    await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => {});
    result.screenshot = screenshotPath;
    await context.tracing.stop({ path: tracePath }).catch(() => {});
    result.trace = tracePath;
  } finally {
    await page.close().catch(() => {});
  }

  return result;
}

function buildSummary(results) {
  const summary = {
    total: results.length,
    passed: 0,
    failed: 0,
    skipped: 0,
    manualRequired: 0,
  };

  for (const result of results) {
    if (Object.hasOwn(summary, result.status)) {
      summary[result.status] += 1;
    }
  }

  return summary;
}

function buildMarkdownReport(report) {
  const lines = [
    '# Web UI Test Execution Report',
    '',
    `Base URL: ${report.baseUrl}`,
    `Total: ${report.summary.total}`,
    `Passed: ${report.summary.passed}`,
    `Failed: ${report.summary.failed}`,
    `Skipped: ${report.summary.skipped}`,
    `Manual required: ${report.summary.manualRequired}`,
    '',
    '| ID | Title | Status | Actions | Manual Steps | Error |',
    '|---|---|---|---:|---:|---|',
  ];

  for (const result of report.results) {
    const error = result.error ? result.error.replace(/\|/g, '\\|') : '';
    lines.push(`| ${result.id} | ${result.title.replace(/\|/g, '\\|')} | ${result.status} | ${result.actionCount} | ${result.manualSteps.length} | ${error} |`);
    if (result.screenshot) lines.push(`| ${result.id} screenshot | ${result.screenshot} |  |  |  |  |`);
    if (result.trace) lines.push(`| ${result.id} trace | ${result.trace} |  |  |  |  |`);
  }

  return `${lines.join('\n')}\n`;
}

async function runWebTestcases(options) {
  await fs.mkdir(options.outputDir, { recursive: true });
  const data = await loadTestcaseData(options);
  const authConfig = await loadAuthConfig(options.authConfig);
  const plans = data.testCases.map((testcase, index) => buildExecutionPlan(testcase, index));

  const browser = await chromium.launch({
    headless: !options.headed,
    executablePath: chromium.executablePath(),
  });
  const context = await browser.newContext();
  try {
    if (authConfig) {
      const loginPage = await context.newPage();
      await performLogin(loginPage, options.baseUrl, authConfig, options.timeoutMs);
      await loginPage.close();
    }

    const results = [];
    for (let index = 0; index < data.testCases.length; index += 1) {
      results.push(await runOneCase(context, data.testCases[index], plans[index], options));
    }

    const report = {
      baseUrl: options.baseUrl,
      outputDir: options.outputDir,
      generatedAt: new Date().toISOString(),
      summary: buildSummary(results),
      results,
    };

    const jsonPath = path.join(options.outputDir, 'web-test-report.json');
    const markdownPath = path.join(options.outputDir, 'web-test-report.md');
    await fs.writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    await fs.writeFile(markdownPath, buildMarkdownReport(report), 'utf8');

    return { ...report, files: { json: jsonPath, markdown: markdownPath } };
  } finally {
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const report = await runWebTestcases(options);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (report.summary.failed > 0) {
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}

export {
  buildExecutionPlan,
  buildMarkdownReport,
  inferActionFromStep,
  loadAuthConfig,
  parseArgs,
  runWebTestcases,
  validateAuthConfig,
};
