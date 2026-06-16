import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

import {
  buildExecutionPlan,
  inferActionFromStep,
  runWebTestcases,
  validateAuthConfig,
} from './run-web-testcases.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

async function skipIfBrowserUnavailable(t) {
  try {
    await fs.access(chromium.executablePath());
  } catch {
    t.skip('Playwright Chromium is not accessible in this environment');
    return true;
  }
  return false;
}

function startServer(handler) {
  const server = http.createServer(handler);
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      resolve({
        baseUrl: `http://127.0.0.1:${address.port}`,
        close: () => new Promise((done) => server.close(done)),
      });
    });
  });
}

function sendHtml(response, html) {
  response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  response.end(html);
}

function createFixtureServer() {
  return startServer((request, response) => {
    if (request.url === '/login') {
      sendHtml(response, [
        '<!doctype html><html><body>',
        '<input name="username">',
        '<input name="password" type="password">',
        '<button type="submit" onclick="document.body.insertAdjacentHTML(\'beforeend\', \'<main data-testid=app-shell>Ready</main>\')">Login</button>',
        '</body></html>',
      ].join(''));
      return;
    }

    if (request.url === '/case') {
      sendHtml(response, [
        '<!doctype html><html><body>',
        '<button id="save" onclick="document.querySelector(\'#result\').textContent = \'保存成功\'">保存</button>',
        '<p id="result"></p>',
        '</body></html>',
      ].join(''));
      return;
    }

    sendHtml(response, '<!doctype html><html><body>Not found</body></html>');
  });
}

test('inferActionFromStep converts common natural language steps with hints', () => {
  const testcase = {
    executionHint: {
      path: '/case',
      inputSelector: '#name',
      inputValue: 'Alice',
      expectedText: '保存成功',
    },
  };

  assert.deepEqual(inferActionFromStep('打开页面', testcase, 0), {
    type: 'goto',
    path: '/case',
    sourceStep: '打开页面',
  });
  assert.deepEqual(inferActionFromStep('点击保存', testcase, 1), {
    type: 'clickText',
    text: '保存',
    sourceStep: '点击保存',
  });
  assert.deepEqual(inferActionFromStep('输入姓名', testcase, 2), {
    type: 'fill',
    selector: '#name',
    value: 'Alice',
    sourceStep: '输入姓名',
  });
  assert.deepEqual(inferActionFromStep('验证结果', testcase, 3), {
    type: 'expectText',
    text: '保存成功',
    sourceStep: '验证结果',
  });
});

test('buildExecutionPlan marks unconvertible steps as manualRequired', () => {
  const plan = buildExecutionPlan({
    id: 'WEB-001',
    title: '无法自动判断复杂业务规则',
    steps: ['根据线下规则判断账单是否合理'],
  }, 0);

  assert.equal(plan.manualRequired, true);
  assert.equal(plan.actions.length, 0);
  assert.equal(plan.manualSteps.length, 1);
  assert.match(plan.manualSteps[0].reason, /cannot be converted/);
});

test('validateAuthConfig reports missing fields clearly', () => {
  assert.throws(
    () => validateAuthConfig({ loginPath: '/login' }),
    /usernameSelector, passwordSelector, submitSelector, successSelector/,
  );
});

test('runWebTestcases executes a successful explicit Playwright draft', async (t) => {
  if (await skipIfBrowserUnavailable(t)) return;

  const server = await createFixtureServer();
  const outputDir = await fs.mkdtemp(path.join(os.tmpdir(), 'web-testcases-pass-'));

  try {
    const report = await runWebTestcases({
      inputJsonText: JSON.stringify({
        testCases: [
          {
            id: 'WEB-PASS',
            title: '点击保存后显示成功文案',
            executionHint: {
              actions: [
                { type: 'goto', path: '/case' },
                { type: 'click', selector: '#save' },
                { type: 'expectText', text: '保存成功' },
              ],
            },
          },
        ],
      }),
      inputJson: null,
      baseUrl: server.baseUrl,
      outputDir,
      authConfig: null,
      headed: false,
      timeoutMs: 5000,
    });

    assert.equal(report.summary.passed, 1);
    assert.equal(report.summary.failed, 0);
    await fs.access(path.join(outputDir, 'web-test-report.json'));
    await fs.access(path.join(outputDir, 'web-test-report.md'));
  } finally {
    await server.close();
    await fs.rm(outputDir, { recursive: true, force: true });
  }
});

test('runWebTestcases performs configured script login before cases', async (t) => {
  if (await skipIfBrowserUnavailable(t)) return;

  const server = await createFixtureServer();
  const outputDir = await fs.mkdtemp(path.join(os.tmpdir(), 'web-testcases-auth-'));
  const authConfigPath = path.join(outputDir, 'auth-config.json');
  const oldUsername = process.env.TEST_USERNAME;
  const oldPassword = process.env.TEST_PASSWORD;

  try {
    await fs.writeFile(authConfigPath, JSON.stringify({
      loginPath: '/login',
      usernameSelector: 'input[name="username"]',
      passwordSelector: 'input[name="password"]',
      submitSelector: 'button[type="submit"]',
      successSelector: '[data-testid="app-shell"]',
    }), 'utf8');
    process.env.TEST_USERNAME = 'tester';
    process.env.TEST_PASSWORD = 'secret';

    const report = await runWebTestcases({
      inputJsonText: JSON.stringify({
        testCases: [
          {
            id: 'WEB-AUTH',
            title: '登录后执行页面检查',
            executionHint: {
              actions: [
                { type: 'goto', path: '/case' },
                { type: 'expectVisible', selector: '#save' },
              ],
            },
          },
        ],
      }),
      inputJson: null,
      baseUrl: server.baseUrl,
      outputDir,
      authConfig: authConfigPath,
      headed: false,
      timeoutMs: 5000,
    });

    assert.equal(report.summary.passed, 1);
  } finally {
    if (oldUsername === undefined) delete process.env.TEST_USERNAME;
    else process.env.TEST_USERNAME = oldUsername;
    if (oldPassword === undefined) delete process.env.TEST_PASSWORD;
    else process.env.TEST_PASSWORD = oldPassword;
    await server.close();
    await fs.rm(outputDir, { recursive: true, force: true });
  }
});

test('runWebTestcases records failed assertions with screenshot and trace', async (t) => {
  if (await skipIfBrowserUnavailable(t)) return;

  const server = await createFixtureServer();
  const outputDir = await fs.mkdtemp(path.join(os.tmpdir(), 'web-testcases-fail-'));

  try {
    const report = await runWebTestcases({
      inputJsonText: JSON.stringify({
        testCases: [
          {
            id: 'WEB-FAIL',
            title: '失败时生成报告产物',
            executionHint: {
              actions: [
                { type: 'goto', path: '/case' },
                { type: 'expectText', text: '不会出现的文案' },
              ],
            },
          },
        ],
      }),
      inputJson: null,
      baseUrl: server.baseUrl,
      outputDir,
      authConfig: null,
      headed: false,
      timeoutMs: 500,
    });

    assert.equal(report.summary.failed, 1);
    assert.match(report.results[0].error, /不会出现的文案|Timeout/);
    await fs.access(report.results[0].screenshot);
    await fs.access(report.results[0].trace);
  } finally {
    await server.close();
    await fs.rm(outputDir, { recursive: true, force: true });
  }
});
