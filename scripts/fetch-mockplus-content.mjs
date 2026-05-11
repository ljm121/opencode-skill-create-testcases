import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const MODULE_RESPONSE_PATTERN = /\/api\/v1\/app\/module\/[^/]+\/[^/?#]+/i;
const JSON_RESPONSE_PATTERN = /application\/json|text\/json/i;
const MAX_ITEMS_PER_BUCKET = 80;
const MAX_BODY_TEXT_ITEMS = 120;

function parseArgs(argv) {
  const options = {
    urls: [],
    input: null,
    outputDir: 'exports/mockplus',
    headed: false,
    timeoutMs: 30000,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const current = argv[i];
    const next = argv[i + 1];

    switch (current) {
      case '--url':
        if (!next) throw new Error('--url 需要传入公开分享链接');
        options.urls.push(next);
        i += 1;
        break;
      case '--input':
        if (!next) throw new Error('--input 需要传入 JSON 文件路径');
        options.input = next;
        i += 1;
        break;
      case '--output-dir':
        if (!next) throw new Error('--output-dir 需要传入输出目录');
        options.outputDir = next;
        i += 1;
        break;
      case '--headed':
        options.headed = true;
        break;
      case '--timeout-ms':
        if (!next) throw new Error('--timeout-ms 需要传入超时毫秒数');
        options.timeoutMs = Number.parseInt(next, 10);
        if (!Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0) {
          throw new Error('--timeout-ms 必须是正整数');
        }
        i += 1;
        break;
      case '--max-depth':
        if (!next) throw new Error('--max-depth 需要传入最大抓取深度（2-5）');
        options.maxDepth = Number.parseInt(next, 10);
        if (!Number.isFinite(options.maxDepth) || options.maxDepth < 2 || options.maxDepth > 5) {
          throw new Error('--max-depth 必须是 2-5 之间的整数');
        }
        i += 1;
        break;
      default:
        throw new Error(`不支持的参数：${current}`);
    }
  }

  options.maxDepth ??= 3;
  return options;
}

async function loadUrls(options) {
  const fromArgs = [...options.urls];
  if (!options.input) return fromArgs;

  const absoluteInput = path.resolve(options.input);
  const raw = await fs.readFile(absoluteInput, 'utf8');
  const parsed = JSON.parse(raw);
  const fromFile = Array.isArray(parsed) ? parsed : parsed?.urls;
  if (!Array.isArray(fromFile)) {
    throw new Error('输入文件必须是 JSON 数组，或包含 urls 数组的对象');
  }

  return [...fromArgs, ...fromFile];
}

function makeSafeName(input) {
  const normalized = input
    .replace(/^https?:\/\//i, '')
    .replace(/[\\/:*?"<>|#%&{}$!'@+=`~]+/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase();

  return normalized || 'mockplus-item';
}

function makeSafeDirName(input) {
  const normalized = input
    .replace(/[\\/:*?"<>|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return normalized || '未命名模块';
}

async function ensureDir(targetDir) {
  await fs.mkdir(targetDir, { recursive: true });
}

async function writeJson(filePath, value) {
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function writeMarkdown(filePath, lines) {
  await fs.writeFile(filePath, `${lines.join('\n')}\n`, 'utf8');
}

function uniqueValues(values, limit = MAX_ITEMS_PER_BUCKET) {
  const seen = new Set();
  const result = [];
  for (const value of values) {
    const trimmed = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    result.push(trimmed);
    if (result.length >= limit) break;
  }
  return result;
}

function isReadableFragment(value, key = '') {
  const trimmed = value.trim();
  if (trimmed.length < 2 || trimmed.length > 400) return false;
  if (/^https?:\/\//i.test(trimmed)) return false;
  if (/^\d{4}-\d{2}-\d{2}t\d{2}:\d{2}:\d{2}/i.test(trimmed)) return false;
  if (/^[a-z0-9+/_=-]{10,}$/i.test(trimmed) && !/[\u4e00-\u9fff\s]/.test(trimmed)) return false;
  if (/^[\w-]+@[\w.-]+\.[a-z]{2,}$/i.test(trimmed)) return false;
  if (/^(default|local|public|prototype|visitor|guest|member|observer|super-admin|admin|axure|icon)$/i.test(trimmed)) return false;
  if (/请登录后继续|未找到此用户信息/i.test(trimmed)) return false;

  const meaningfulKey = /title|name|text|content|description|remark|label|page|module|scene|feature/i.test(key);
  const hasReadableChars = /[\u4e00-\u9fff]/.test(trimmed) || /[a-z]{3,}(?:\s+[a-z]{2,})+/i.test(trimmed);
  return meaningfulKey || hasReadableChars;
}

function collectTextFragments(value, fragments, seen, depth = 0) {
  if (depth > 6 || value === null || value === undefined) return;

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (isReadableFragment(trimmed) && !seen.has(trimmed)) {
      seen.add(trimmed);
      fragments.push(trimmed);
    }
    return;
  }

  if (Array.isArray(value)) {
    for (const item of value) collectTextFragments(item, fragments, seen, depth + 1);
    return;
  }

  if (typeof value === 'object') {
    for (const [key, nested] of Object.entries(value)) {
      if (/token|password|cookie|authorization/i.test(key)) continue;

      if (typeof nested === 'string') {
        const trimmed = nested.trim();
        if (isReadableFragment(trimmed, key) && !seen.has(trimmed)) {
          seen.add(trimmed);
          fragments.push(trimmed);
        }
        continue;
      }

      collectTextFragments(nested, fragments, seen, depth + 1);
    }
  }
}

function shouldCaptureFullJson(url) {
  return MODULE_RESPONSE_PATTERN.test(url);
}

function isUsefulModuleName(name) {
  if (!name) return false;
  const hasChinese = /[\u4e00-\u9fff]/.test(name);
  const hasEnglish = /[a-zA-Z]{2,}/.test(name);
  if (!hasChinese && !hasEnglish) return false;
  if (/企业端$/.test(name)) return false;
  if (!hasChinese && /^\d+[-_]?\d*$/.test(name)) return false;
  return true;
}

function classifyFailure(error, pageSignals = []) {
  const text = `${error?.message || ''} ${pageSignals.join(' ')}`.toLowerCase();
  if (text.includes('timeout') || text.includes('超时')) return 'timeout';
  if (text.includes('login') || text.includes('登录') || text.includes('请登录')) return 'login_required';
  if (text.includes('无权限') || text.includes('permission') || text.includes('没有权限') || text.includes('forbidden') || text.includes('403')) return 'permission_denied';
  if (text.includes('empty') || text.includes('no readable') || text.includes('空白') || text.includes('404') || text.includes('not found')) return 'empty_content';
  if (text.includes('no module') || text.includes('no payload') || text.includes('无法解析')) return 'unparseable';
  if (text.includes('refused') || text.includes('econnrefused') || text.includes('enetunreach') || text.includes('dns')) return 'network_error';
  return 'structure_changed';
}

function flattenModulePages(payload) {
  const modules = [];

  function buildChildrenRecursive(children = [], currentDepth) {
    if (currentDepth > 4) return [];
    return children
      .filter((child) => child?.dataURL)
      .map((child) => ({
        id: child._id,
        name: child.name,
        slug: makeSafeDirName(child.name),
        dataURL: child.dataURL,
        source: child.source || '',
        designDescription: child.designDescription || '',
        depth: currentDepth,
        children: buildChildrenRecursive(child.children, currentDepth + 1),
      }));
  }

  for (const page of payload?.pages || []) {
    if (page?.isGroup && Array.isArray(page.children)) {
      for (const child of page.children) {
        if (!child?.dataURL || !isUsefulModuleName(child.name)) continue;
        modules.push({
          id: child._id,
          name: child.name,
          slug: makeSafeDirName(child.name),
          dataURL: child.dataURL,
          source: child.source || '',
          designDescription: child.designDescription || '',
          parentGroup: page.name,
          depth: 1,
          children: buildChildrenRecursive(child.children, 2),
        });
      }
      continue;
    }

    if (page?.dataURL && isUsefulModuleName(page.name)) {
      modules.push({
        id: page._id,
        name: page.name,
        slug: makeSafeDirName(page.name),
        dataURL: page.dataURL,
        source: page.source || '',
        designDescription: page.designDescription || '',
        parentGroup: '',
        depth: 1,
        children: buildChildrenRecursive(page.children, 2),
      });
    }
  }

  const deduped = [];
  const seen = new Set();
  for (const module of modules) {
    if (seen.has(module.name)) continue;
    seen.add(module.name);
    deduped.push(module);
  }
  return deduped;
}

async function extractStructuredDom(page) {
  return page.evaluate((maxBodyTextItems) => {
    const selectors = {
      headings: 'h1, h2, h3, h4',
      buttons: 'button, [role="button"], a, .button, .btn',
      labels: 'label, .label, .form-label, .ant-form-item-label, .el-form-item__label, .field-label, .title, .name',
      tableHeaders: 'th, thead td, .table-header, .ant-table-thead th, .el-table th',
      statusTexts: '.status, .tag, .badge, .ant-tag, .el-tag, .chip, .toast, .message, .alert, .ant-message-notice-content, .ant-notification-notice-message',
    };

    const rejected = new Set(['登录', '注册', '返回', '关闭', '更多', 'loading']);

    const readTexts = (selector, limit) => {
      return [...document.querySelectorAll(selector)]
        .map((element) => {
          const style = window.getComputedStyle(element);
          if (style.display === 'none' || style.visibility === 'hidden') return '';
          return (element.innerText || element.textContent || '').replace(/\s+/g, ' ').trim();
        })
        .filter((text) => text && !rejected.has(text.toLowerCase()))
        .slice(0, limit);
    };

    const bodyText = [...document.querySelectorAll('body *')]
      .map((element) => {
        const style = window.getComputedStyle(element);
        if (style.display === 'none' || style.visibility === 'hidden') return '';
        return (element.innerText || element.textContent || '').replace(/\s+/g, ' ').trim();
      })
      .filter((text) => text && !rejected.has(text.toLowerCase()))
      .slice(0, maxBodyTextItems);

    return {
      title: document.title || '',
      headings: readTexts(selectors.headings, 20),
      buttons: readTexts(selectors.buttons, 30),
      labels: readTexts(selectors.labels, 50),
      tableHeaders: readTexts(selectors.tableHeaders, 30),
      statusTexts: readTexts(selectors.statusTexts, 30),
      bodyText,
    };
  }, MAX_BODY_TEXT_ITEMS);
}

async function capturePageResponses(page, options) {
  const responses = [];
  page.setDefaultTimeout(options.timeoutMs);
  page.on('response', async (response) => {
    const url = response.url();
    const contentType = response.headers()['content-type'] || '';
    const item = {
      url,
      status: response.status(),
      contentType,
      parsedJson: false,
      extractedText: [],
    };

    if (JSON_RESPONSE_PATTERN.test(contentType) && /mockplus\.cn\/api\/v1|img02\.mockplus\.cn/i.test(url)) {
      try {
        const json = await response.json();
        item.parsedJson = true;
        item.extractedText = uniqueValues((() => {
          const values = [];
          collectTextFragments(json, values, new Set());
          return values;
        })(), 80);
        if (shouldCaptureFullJson(url)) item.fullJson = json;
      } catch {
        item.parsedJson = false;
      }
    }

    if (item.parsedJson || /mockplus\.cn\/api\/v1|img02\.mockplus\.cn/i.test(url)) {
      responses.push(item);
    }
  });
  return responses;
}

function mergeResponseText(responses) {
  const merged = [];
  const seen = new Set();
  for (const response of responses) {
    for (const item of response.extractedText || []) {
      if (!seen.has(item)) {
        seen.add(item);
        merged.push(item);
      }
    }
  }
  return merged;
}

async function scrapeWithRetry(browser, pageDescriptor, options, retries = 2) {
  const delays = [1000, 3000];
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await scrapePrototypePage(browser, pageDescriptor, options);
    } catch (error) {
      if (attempt < retries) {
        await new Promise((resolve) => setTimeout(resolve, delays[attempt] || 5000));
        continue;
      }
      throw error;
    }
  }
}

async function scrapePrototypePage(browser, pageDescriptor, options) {
  const page = await browser.newPage();
  const responses = await capturePageResponses(page, options);

  try {
    await page.goto(pageDescriptor.dataURL, { waitUntil: 'domcontentloaded', timeout: options.timeoutMs });
    await page.waitForLoadState('networkidle', { timeout: Math.min(options.timeoutMs, 10000) }).catch(() => {});
    await page.waitForTimeout(1500);

    const dom = await extractStructuredDom(page);
    return {
      id: pageDescriptor.id,
      name: pageDescriptor.name,
      depth: pageDescriptor.depth,
      dataURL: pageDescriptor.dataURL,
      pageTitle: dom.title,
      headings: uniqueValues(dom.headings),
      buttons: uniqueValues(dom.buttons),
      labels: uniqueValues(dom.labels, 80),
      tableHeaders: uniqueValues(dom.tableHeaders),
      statusTexts: uniqueValues(dom.statusTexts),
      bodyText: uniqueValues(dom.bodyText, MAX_BODY_TEXT_ITEMS),
      networkText: uniqueValues(mergeResponseText(responses), 120),
      responses: responses.slice(0, 50),
    };
  } finally {
    await page.close();
  }
}

function buildModuleMarkdown(module, rootPage, secondLayerPages, thirdLayerPages = []) {
  const lines = [
    '# Mockplus 模块内容抓取结果',
    '',
    `- 模块名称：${module.name}`,
    `- 模块层级：${module.depth}`,
    `- 来源页面：${module.dataURL}`,
    `- 第二层页面数量：${secondLayerPages.length}`,
    thirdLayerPages.length > 0 ? `- 第三层页面数量：${thirdLayerPages.length}` : '',
    '',
    '## 模块首页',
    '',
    `- 页面标题：${rootPage.pageTitle || module.name}`,
    '',
    '### 标题',
    ...rootPage.headings.map((item) => `- ${item}`),
    '',
    '### 按钮与操作',
    ...rootPage.buttons.map((item) => `- ${item}`),
    '',
    '### 表单与字段标签',
    ...rootPage.labels.map((item) => `- ${item}`),
    '',
    '### 表格列与状态',
    ...rootPage.tableHeaders.concat(rootPage.statusTexts).map((item) => `- ${item}`),
    '',
    '### 正文片段',
    ...rootPage.bodyText.slice(0, 60).map((item) => `- ${item}`),
  ];

  function writePage(page, label) {
    lines.push('', `## ${label}：${page.name}`, '');
    lines.push(`- 页面标题：${page.pageTitle || page.name}`);
    lines.push('');
    lines.push('### 标题');
    lines.push(...page.headings.map((item) => `- ${item}`));
    lines.push('');
    lines.push('### 按钮与操作');
    lines.push(...page.buttons.map((item) => `- ${item}`));
    lines.push('');
    lines.push('### 表单与字段标签');
    lines.push(...page.labels.map((item) => `- ${item}`));
    lines.push('');
    lines.push('### 表格列与状态');
    lines.push(...page.tableHeaders.concat(page.statusTexts).map((item) => `- ${item}`));
    lines.push('');
    lines.push('### 正文片段');
    lines.push(...page.bodyText.slice(0, 60).map((item) => `- ${item}`));
  }

  for (const page of secondLayerPages) {
    writePage(page, '第二层页面');
  }
  for (const page of thirdLayerPages) {
    writePage(page, '第三层页面');
  }

  return lines;
}

async function writeModuleArtifacts(shareDir, module, rootPage, secondLayerPages, thirdLayerPages = []) {
  const moduleDir = path.join(shareDir, module.slug);
  await ensureDir(moduleDir);

  const rawPath = path.join(moduleDir, 'raw.json');
  const normalizedPath = path.join(moduleDir, 'normalized.md');
  const statusPath = path.join(moduleDir, 'status.json');

  const raw = {
    module,
    rootPage,
    secondLayerPages,
    ...(thirdLayerPages.length > 0 ? { thirdLayerPages } : {}),
  };

  const depthReached = thirdLayerPages.length > 0 ? 3 : (secondLayerPages.length > 0 ? 2 : 1);
  const status = {
    module: module.name,
    success: true,
    depthReached,
    secondLayerPageCount: secondLayerPages.length,
    thirdLayerPageCount: thirdLayerPages.length,
    files: {
      raw: rawPath,
      normalized: normalizedPath,
      status: statusPath,
    },
  };

  await writeJson(rawPath, raw);
  await writeMarkdown(normalizedPath, buildModuleMarkdown(module, rootPage, secondLayerPages, thirdLayerPages));
  await writeJson(statusPath, status);

  return {
    module: module.name,
    outputDir: moduleDir,
    files: status.files,
    depthReached,
    secondLayerPageCount: secondLayerPages.length,
    thirdLayerPageCount: thirdLayerPages.length,
  };
}

async function fetchSingleUrlData(browser, url, options) {
  const page = await browser.newPage();
  const responses = await capturePageResponses(page, options);

  const result = {
    url,
    title: '',
    success: false,
    method: 'module-deep-crawl',
    failureCode: null,
    failureReason: null,
    generatedAt: new Date().toISOString(),
    modules: [],
  };

  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: options.timeoutMs });
    await page.waitForLoadState('networkidle', { timeout: Math.min(options.timeoutMs, 10000) }).catch(() => {});
    await page.waitForTimeout(3000);

    result.title = await page.title();
    const dom = await extractStructuredDom(page);
    const moduleResponse = responses.find((item) => item.fullJson?.payload?.pages);
    const modules = flattenModulePages(moduleResponse?.fullJson?.payload);

    if (modules.length === 0) {
      throw new Error('No module payload extracted');
    }

    async function scrapeSubPages(pageDescriptor, currentDepth) {
      if (currentDepth > options.maxDepth || !pageDescriptor.children?.length) return [];
      const results = [];
      for (const child of pageDescriptor.children.slice(0, 10)) {
        try {
          const scraped = await scrapeWithRetry(browser, child, options);
          const grandchildren = await scrapeSubPages(child, currentDepth + 1);
          results.push({ page: scraped, children: grandchildren });
        } catch {
          // Skip pages that fail to load
        }
      }
      return results;
    }

    const moduleResults = [];
    for (const module of modules) {
      const rootPage = await scrapeWithRetry(browser, module, options);
      const secondLayerPages = [];
      const thirdLayerPages = [];
      for (const child of module.children.slice(0, 10)) {
        try {
          const scraped = await scrapeWithRetry(browser, child, options);
          secondLayerPages.push(scraped);
          if (options.maxDepth >= 3) {
            for (const grandchild of child.children.slice(0, 6)) {
              try {
                thirdLayerPages.push(await scrapeWithRetry(browser, grandchild, options));
              } catch {
                // skip
              }
            }
          }
        } catch {
          // Skip pages that fail to load
        }
      }
      const allPages = [rootPage, ...secondLayerPages, ...thirdLayerPages];
      moduleResults.push({
        module,
        rootPage,
        secondLayerPages,
        thirdLayerPages: options.maxDepth >= 3 ? thirdLayerPages : [],
        depthReached: thirdLayerPages.length > 0 ? 3 : (secondLayerPages.length > 0 ? 2 : 1),
        secondLayerPageCount: secondLayerPages.length,
        thirdLayerPageCount: thirdLayerPages.length,
      });
    }

    result.success = true;
    result.modules = moduleResults;
    result.shareRaw = {
      url,
      title: result.title,
      finalUrl: page.url(),
      moduleResponse: moduleResponse?.fullJson || null,
      responses: responses.slice(0, 50),
      networkText: uniqueValues(mergeResponseText(responses), 120),
      domText: uniqueValues(dom.bodyText, 80),
      modules,
    };
    return result;
  } catch (error) {
    result.failureCode = classifyFailure(error);
    result.failureReason = error instanceof Error ? error.message : String(error);
    result.shareRaw = {
      url,
      title: result.title,
      finalUrl: page.url(),
      responses: responses.slice(0, 50),
    };
    return result;
  } finally {
    await page.close();
  }
}

async function fetchSingleUrl(browser, url, options) {
  const safeName = makeSafeName(url);
  const shareDir = path.resolve(options.outputDir, safeName);
  await ensureDir(shareDir);

  const shareRawPath = path.join(shareDir, 'raw.json');
  const shareNormalizedPath = path.join(shareDir, 'normalized.md');
  const shareStatusPath = path.join(shareDir, 'status.json');

  const status = await fetchSingleUrlData(browser, url, options);
  status.files = {
    raw: shareRawPath,
    normalized: shareNormalizedPath,
    status: shareStatusPath,
  };

  try {
    if (status.success) {
      const moduleResults = [];
      for (const item of status.modules) {
        moduleResults.push(await writeModuleArtifacts(shareDir, item.module, item.rootPage, item.secondLayerPages, item.thirdLayerPages));
      }

      const shareLines = [
        '# Mockplus 分享页模块摘要',
        '',
        `- 来源链接：${url}`,
        `- 页面标题：${status.title || '未识别'}`,
        `- 识别模块数：${moduleResults.length}`,
        '',
        '## 模块列表',
        '',
        ...moduleResults.map((item) => `- ${item.module}：深度 ${item.depthReached}，第二层页面 ${item.secondLayerPageCount} 个`),
      ];

      status.modules = moduleResults;
      await writeJson(shareRawPath, status.shareRaw);
      await writeMarkdown(shareNormalizedPath, shareLines);
      await writeJson(shareStatusPath, status);
      return status;
    }

    await writeJson(shareRawPath, status.shareRaw);
    await writeMarkdown(shareNormalizedPath, ['# Mockplus 分享页模块摘要', '', '- 未提取到可用模块内容']);
    await writeJson(shareStatusPath, status);
    return status;
  } finally {
    delete status.shareRaw;
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const urls = await loadUrls(options);
  if (urls.length === 0) throw new Error('Provide at least one --url or an --input JSON file');

  await ensureDir(path.resolve(options.outputDir));
  const browser = await chromium.launch({ headless: !options.headed });

  try {
    const results = [];
    for (const url of urls) {
      results.push(await fetchSingleUrl(browser, url, options));
    }
    process.stdout.write(`${JSON.stringify({ outputDir: path.resolve(options.outputDir), results }, null, 2)}\n`);
  } finally {
    await browser.close();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}

export { fetchSingleUrlData, makeSafeName };
