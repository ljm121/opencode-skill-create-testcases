import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { fetchSingleUrlData, makeSafeName } from './fetch-mockplus-content.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

function parseArgs(argv) {
  const options = {
    url: null,
    outputDir: null,
    timeoutMs: 30000,
    headed: false,
    maxDepth: 3,
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

  if (!options.url) {
    throw new Error('必须提供 --url（Mockplus 公开分享链接）');
  }

  return options;
}

function extractAllText(fetched) {
  const texts = [];
  for (const mod of fetched.modules || []) {
    const pages = [mod.rootPage, ...(mod.secondLayerPages || []), ...(mod.thirdLayerPages || [])];
    for (const page of pages) {
      texts.push(...(page.headings || []));
      texts.push(...(page.labels || []));
      texts.push(...(page.buttons || []));
      texts.push(...(page.tableHeaders || []));
      texts.push(...(page.statusTexts || []));
      texts.push(...(page.bodyText || []));
      texts.push(...(page.networkText || []));
    }
  }
  texts.push(...(fetched.shareRaw?.networkText || []));
  texts.push(...(fetched.shareRaw?.domText || []));
  return [...new Set(texts.map((t) => t.replace(/\s+/g, ' ').trim()).filter(Boolean))];
}

const BACKGROUND_PATTERNS = [
  /需求背景|背景|当前现状|现状描述|问题背景/i,
  /当前影响|影响范围|存在的问题|问题描述|目前.*问题/i,
  /需求目标|目标|目的|优化目标|业务目标/i,
  /历史数据|历史数据处理|数据迁移|存量数据/i,
];

const RULE_PATTERNS = [
  /分摊|手续费|手续费分摊|出款流水手续费|调差/i,
  /统计逻辑|统计时间|交易时间|认款时间/i,
  /自营请款|承包商请款|出款单|出款流水/i,
  /匹配规则|分摊规则|三级|兜底|候选项目/i,
  /对方账户|人员明细|未匹配|按人数/i,
  /总金额|相减|月度|月末/i,
];

function isRequirementHeading(text) {
  return /^[一二三三四五六七八九十]+[、．.]/.test(text)
    || /^\d{1,2}[.．]\d{1,2}/.test(text)
    || BACKGROUND_PATTERNS.some((p) => p.test(text))
    || /需求|背景|目标|影响|规则|逻辑|调整|方案|处理|统计|分摊|匹配|调差/i.test(text);
}

function categorizeText(texts) {
  const background = [];
  const problems = [];
  const goals = [];
  const rules = [];
  const dataFlow = [];
  const historicalData = [];
  const others = [];

  const lowerTexts = texts.map((t) => t.toLowerCase());

  for (let i = 0; i < texts.length; i += 1) {
    const text = texts[i];
    const lower = lowerTexts[i];

    if (BACKGROUND_PATTERNS[0].test(text) || /^一[、．.]/.test(text)) {
      background.push(text);
    } else if (BACKGROUND_PATTERNS[1].test(text) || /二[、．.]/.test(text)) {
      problems.push(text);
    } else if (BACKGROUND_PATTERNS[2].test(text) || /三[、．.]/.test(text)) {
      goals.push(text);
    } else if (BACKGROUND_PATTERNS[3].test(text) || /四[、．.]/.test(text)) {
      historicalData.push(text);
    } else if (RULE_PATTERNS.some((p) => p.test(text))) {
      rules.push(text);
    } else if (/(数据流|流程|[输输]入|查[询找]|关联)/i.test(text)) {
      dataFlow.push(text);
    } else if (/^[一二三三四五六七八九十]+[、．.]/.test(text) && isRequirementHeading(text)) {
      background.push(text);
    } else if (text.length > 8) {
      others.push(text);
    }
  }

  return { background, problems, goals, rules, dataFlow, historicalData, others };
}

function extractModuleNames(fetched) {
  return (fetched.modules || []).map((m) => m.module?.name).filter(Boolean);
}

function extractBusinessRules(texts) {
  const rules = [];
  const seen = new Set();

  for (const text of texts) {
    if (!RULE_PATTERNS.some((p) => p.test(text))) continue;
    const dedupKey = text.slice(0, 30);
    if (seen.has(dedupKey)) continue;
    seen.add(dedupKey);

    const ruleText = text.replace(/\s+/g, ' ').trim();
    if (ruleText.length > 10) {
      rules.push(ruleText);
    }
  }

  const grouped = { tier1: [], tier2: [], tier3: [], fallback: [], general: [] };

  for (const rule of rules) {
    if (/第一级|对方账户.*名称.*币种.*金额/u.test(rule) || /对方账户.*唯一定位/u.test(rule)) {
      grouped.tier1.push(rule);
    } else if (/第二级|金额.*币种.*唯一定位/u.test(rule) || /无法通过对方账户/u.test(rule)) {
      grouped.tier2.push(rule);
    } else if (/第三级|兜底|未匹配人数|候选项目/u.test(rule) || /最后.*总金额.*相减/u.test(rule)) {
      grouped.tier3.push(rule);
    } else if (/兜底|未匹配人数|候选项目|月末|月度/u.test(rule)) {
      grouped.fallback.push(rule);
    } else {
      grouped.general.push(rule);
    }
  }

  return grouped;
}

function buildSummary(fetched) {
  const allTexts = extractAllText(fetched);
  const categorized = categorizeText(allTexts);
  const moduleNames = extractModuleNames(fetched);
  const rules = extractBusinessRules(allTexts);

  const lines = [];
  lines.push('# 需求要点', '');

  if (moduleNames.length > 0) {
    lines.push('> 来源模块：' + moduleNames.join('、'));
    lines.push('');
  }

  if (categorized.background.length > 0) {
    lines.push('## 需求背景', '');
    for (const item of categorized.background) {
      if (isRequirementHeading(item)) {
        lines.push('### ' + item);
      } else {
        lines.push('- ' + item);
      }
    }
    lines.push('');
  }

  if (categorized.problems.length > 0) {
    lines.push('## 当前问题', '');
    for (const item of categorized.problems) {
      lines.push('- ' + item);
    }
    lines.push('');
  }

  if (categorized.goals.length > 0) {
    lines.push('## 需求目标', '');
    for (const item of categorized.goals) {
      lines.push('- ' + item);
    }
    lines.push('');
  }

  const hasTierRules = rules.tier1.length > 0 || rules.tier2.length > 0 || rules.tier3.length > 0;
  if (hasTierRules) {
    lines.push('## 分摊规则', '');
    if (rules.tier1.length > 0) {
      lines.push('### 第一级：对方账户名称 + 币种 + 金额', '');
      for (const item of rules.tier1) {
        lines.push('- ' + item);
      }
      lines.push('');
    }
    if (rules.tier2.length > 0) {
      lines.push('### 第二级：金额 + 币种', '');
      for (const item of rules.tier2) {
        lines.push('- ' + item);
      }
      lines.push('');
    }
    if (rules.tier3.length > 0) {
      lines.push('### 第三级：兜底分摊', '');
      for (const item of rules.tier3) {
        lines.push('- ' + item);
      }
      lines.push('');
    }
  }

  if (rules.fallback.length > 0) {
    lines.push('## 兜底处理', '');
    for (const item of rules.fallback) {
      lines.push('- ' + item);
    }
    lines.push('');
  }

  if (categorized.rules.length > 0 && !hasTierRules) {
    lines.push('## 核心规则', '');
    for (const item of categorized.rules) {
      lines.push('- ' + item);
    }
    lines.push('');
  }

  if (categorized.historicalData.length > 0) {
    lines.push('## 历史数据处理', '');
    for (const item of categorized.historicalData) {
      lines.push('- ' + item);
    }
    lines.push('');
  }

  if (categorized.dataFlow.length > 0) {
    lines.push('## 数据流', '');
    for (const item of categorized.dataFlow) {
      lines.push('- ' + item);
    }
    lines.push('');
  }

  if (categorized.others.length > 0) {
    lines.push('## 其他说明', '');
    const deduped = [...new Set(categorized.others)];
    for (const item of deduped.slice(0, 30)) {
      lines.push('- ' + item);
    }
    if (deduped.length > 30) {
      lines.push('- *...以及 ' + (deduped.length - 30) + ' 条其他内容*');
    }
    lines.push('');
  }

  lines.push('---', '');
  lines.push('_自动生成时间：' + new Date().toISOString() + '_');
  lines.push('_来源链接：' + fetched.url + '_');

  if (!fetched.success) {
    return [
      '# 需求要点提取失败',
      '',
      '未能从该 Mockplus 链接中提取到有效内容。',
      '',
      '| 项目 | 内容 |',
      '|------|------|',
      '| 失败原因 | ' + (fetched.failureReason || '未知') + ' |',
      '| 失败代码 | ' + (fetched.failureCode || 'unknown') + ' |',
      '| 来源链接 | ' + fetched.url + ' |',
      '',
    ];
  }

  return lines;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  const browser = await chromium.launch({ headless: !options.headed });
  try {
    const result = await fetchSingleUrlData(browser, options.url, options);
    const lines = buildSummary(result);
    const output = lines.join('\n');

    if (options.outputDir) {
      const safeName = makeSafeName(options.url);
      const outDir = path.resolve(options.outputDir, safeName);
      await fs.mkdir(outDir, { recursive: true });
      const outPath = path.join(outDir, 'requirements.md');
      await fs.writeFile(outPath, output, 'utf8');
      process.stdout.write(JSON.stringify({
        success: result.success,
        url: options.url,
        outputPath: outPath,
        moduleCount: (result.modules || []).length,
        failureCode: result.failureCode || null,
        failureReason: result.failureReason || null,
      }) + '\n');
      return;
    }

    process.stdout.write(output + '\n');
  } finally {
    await browser.close();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((error) => {
    process.stderr.write(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : String(error),
    }) + '\n');
    process.exitCode = 1;
  });
}

export { buildSummary };
