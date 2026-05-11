import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

function parseArgs(argv) {
  const options = {
    inputDir: null,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const current = argv[i];
    const next = argv[i + 1];
    switch (current) {
      case '--input-dir':
        if (!next) throw new Error('--input-dir 需要传入模块中间文件目录');
        options.inputDir = path.resolve(next);
        i += 1;
        break;
      default:
        throw new Error(`不支持的参数：${current}`);
    }
  }

  if (!options.inputDir) throw new Error('必须提供 --input-dir');
  return options;
}

function uniqueValues(values, limit = 20) {
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

function makePrefix(moduleName) {
  const latin = moduleName.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  if (latin) return latin.slice(0, 12);
  return 'MPSHARE';
}

function stripModuleName(name) {
  return name.replace(/（.*?）/g, '').replace(/\s+/g, ' ').trim();
}

function summarizePages(raw) {
  const pages = [raw.rootPage, ...(raw.secondLayerPages || []), ...(raw.thirdLayerPages || [])].filter(Boolean);
  const pageNames = pages.map((page) => page.name);
  const headings = uniqueValues(pages.flatMap((page) => page.headings || []), 12);
  const labels = uniqueValues(pages.flatMap((page) => page.labels || []), 20);
  const buttons = uniqueValues(pages.flatMap((page) => page.buttons || []), 20);
  const headers = uniqueValues(pages.flatMap((page) => page.tableHeaders || []), 20);
  const statuses = uniqueValues(pages.flatMap((page) => page.statusTexts || []), 20);
  const bodyText = uniqueValues(pages.flatMap((page) => page.bodyText || []), 20);
  return { pages, pageNames, headings, labels, buttons, headers, statuses, bodyText };
}

const NOTIFICATION_TRIGGER_PATTERN = /邮件|通知|消息|提醒|message|mail|invite|onboarding|待客户签署|已签约|放弃入职|成功入职|即将到期/u;
const NOTIFICATION_SCENARIO_PATTERN = /邮件|通知|消息|提醒|邀请.*签约|待客户签署|已签约|放弃入职|成功入职|即将到期|发送/u;

function isNotificationModule(moduleName, summary) {
  const textPool = [moduleName, ...summary.headings, ...summary.bodyText].join(' ');
  return NOTIFICATION_TRIGGER_PATTERN.test(textPool);
}

function extractNotificationScenarios(summary) {
  const candidates = uniqueValues([
    ...summary.headings,
    ...summary.bodyText,
  ], 40);

  const matched = candidates.filter((item) => {
    if (item.length < 4 || item.length > 80) return false;
    if (!NOTIFICATION_SCENARIO_PATTERN.test(item)) return false;
    if (/立即查看|点击查看|查看详情|签约通知$/u.test(item)) return false;
    return true;
  });

  return matched.filter((item, index) => {
    return !matched.some((other, otherIndex) => {
      if (index === otherIndex) return false;
      if (other.length >= item.length) return false;
      return item.startsWith(other) && /[，。；：,.]/u.test(item.slice(other.length));
    });
  }).slice(0, 12);
}

function buildNotificationTitle(scenario) {
  if (/邀请.*签约/u.test(scenario)) return `${scenario}时发送签约邀请通知`;
  if (/待客户签署/u.test(scenario)) return `${scenario}时发送待签署通知`;
  if (/即将到期/u.test(scenario)) return `${scenario}时发送到期提醒通知`;
  if (/放弃入职/u.test(scenario)) return `${scenario}时发送放弃入职通知`;
  if (/成功入职/u.test(scenario)) return `${scenario}时发送入职结果通知`;
  if (/已签约/u.test(scenario)) return `${scenario}时发送签约完成通知`;
  return `${scenario}时发送对应通知内容`;
}

function buildNotificationExpectedResult(scenario) {
  return `通知内容应与“${scenario}”场景保持一致，包含明确的通知对象、触发结果、关键说明信息以及动作引导。`;
}

function buildNotificationModuleTestCases(moduleName, scenarios, prefix) {
  const cleanModuleName = stripModuleName(moduleName);
  return scenarios.map((scenario, index) => ({
    id: `${prefix}-${String(index + 1).padStart(3, '0')}`,
    module: cleanModuleName,
    scenario,
    title: buildNotificationTitle(scenario),
    preconditions: `${moduleName}模块存在“${scenario}”对应的通知或消息内容。`,
    steps: [
      `进入${moduleName}模块。`,
      `定位“${scenario}”对应的通知或消息内容。`,
      '检查顶部描述、核心通知内容和动作引导文案。',
    ],
    expectedResult: buildNotificationExpectedResult(scenario),
    priority: 'P1',
    testType: '功能',
    notes: '基于 Mockplus 抓取到的通知/消息顶部描述生成。',
  }));
}

function buildNotificationModuleJson(raw, summary) {
  const moduleName = raw.module.name;
  const prefix = makePrefix(moduleName);
  const cleanModuleName = stripModuleName(moduleName);
  const matchedScenarios = extractNotificationScenarios(summary);

  if (matchedScenarios.length === 0) {
    return null;
  }

  return {
    prefix,
    documentSummary: {
      name: `${moduleName} 通知场景测试分析`,
      type: 'mockplus-module',
      parseResult: `基于模块首页抓取到的通知或消息顶部描述，已识别 ${matchedScenarios.length} 个业务通知场景，并按场景生成测试用例。`,
      missingInfo: '当前仍未覆盖模板变量替换规则、通知发送触发条件、跳转落地页行为以及更细的字段级校验。',
    },
    requirementSummary: matchedScenarios.map((item) => `${moduleName}包含“${item}”通知场景。`),
    openQuestions: [
      `${cleanModuleName}模块的通知模板变量替换规则、发送时机和收件人范围仍需结合正式需求确认。`,
      `${cleanModuleName}模块当前仅基于可抓取页面内容生成，未覆盖点击按钮后的落地页与权限差异。`,
    ],
    testScope: matchedScenarios.map((item) => `${cleanModuleName}${item}通知内容与动作引导`),
    risks: uniqueValues([
      `${moduleName}模块当前由页面顶部描述识别通知场景，若页面结构调整或标题文案变化，场景识别结果可能受影响。`,
      '基于 Mockplus 自动抓取生成的测试用例仍需结合正式需求确认业务约束和异常分支。',
    ], 5),
    testCases: buildNotificationModuleTestCases(moduleName, matchedScenarios, prefix),
  };
}

function buildTestCases(moduleName, summary, prefix) {
  const cleanModuleName = stripModuleName(moduleName);
  const testCases = [];
  let index = 1;

  if (summary.labels.length > 0) {
    testCases.push({
      id: `${prefix}-${String(index).padStart(3, '0')}`,
      module: cleanModuleName,
      scenario: '字段展示',
      title: `${cleanModuleName}模块正确展示关键字段和表单项`,
      preconditions: `${moduleName}模块页面及相关二层页面可正常访问。`,
      steps: [
        `进入${moduleName}模块首页。`,
        '查看页面中的字段标签、表单项和说明文案。',
        ...(summary.pages.length > 1 ? ['进入该模块可访问的详情页、弹窗或二层页面，继续查看字段信息。'] : []),
      ],
      expectedResult: `页面中正确展示关键信息字段，例如：${summary.labels.slice(0, 6).join('、')}。`,
      priority: 'P1',
      testType: '功能',
      notes: '该用例基于自动抓取到的实际字段标签生成。',
    });
    index += 1;
  }

  if (summary.buttons.length > 0) {
    testCases.push({
      id: `${prefix}-${String(index).padStart(3, '0')}`,
      module: cleanModuleName,
      scenario: '操作入口',
      title: `${cleanModuleName}模块展示关键操作入口并支持对应业务动作`,
      preconditions: `${moduleName}模块页面可正常访问。`,
      steps: [
        `进入${moduleName}模块。`,
        '查看页面中的按钮、链接或操作入口。',
        ...(summary.pages.length > 1 ? ['进入该模块二层页面，确认二层页面的关键操作入口。'] : []),
      ],
      expectedResult: `页面中存在明确的关键操作入口，例如：${summary.buttons.slice(0, 6).join('、')}，且操作语义清晰。`,
      priority: 'P1',
      testType: '功能',
      notes: '后续可在补充交互规则后细化正向、异常和权限分支。',
    });
    index += 1;
  }

  if (summary.headers.length > 0 || summary.statuses.length > 0) {
    const combined = uniqueValues([...summary.headers, ...summary.statuses], 8);
    testCases.push({
      id: `${prefix}-${String(index).padStart(3, '0')}`,
      module: cleanModuleName,
      scenario: '列表与状态',
      title: `${cleanModuleName}模块正确展示列表列信息和状态信息`,
      preconditions: `${moduleName}模块存在列表区、表格区或状态展示区。`,
      steps: [
        `进入${moduleName}模块。`,
        '查看列表、表格或状态展示区域。',
        ...(summary.pages.length > 1 ? ['进入详情页或二层页面，查看是否存在关联列表或状态信息。'] : []),
      ],
      expectedResult: `页面可展示关键列表列或状态信息，例如：${combined.join('、')}。`,
      priority: 'P1',
      testType: '功能',
      notes: '适用于账单、审批、人员等包含列表或状态流转的模块。',
    });
    index += 1;
  }

  if (summary.bodyText.length > 0) {
    testCases.push({
      id: `${prefix}-${String(index).padStart(3, '0')}`,
      module: cleanModuleName,
      scenario: '内容展示',
      title: `${cleanModuleName}模块正确展示关键业务说明和提示文案`,
      preconditions: `${moduleName}模块页面可正常访问。`,
      steps: [
        `进入${moduleName}模块及相关二层页面。`,
        '查看页面中的业务说明、提示文案、注意事项或规则描述。',
      ],
      expectedResult: `页面中展示与业务相关的说明文案，覆盖自动抓取到的关键内容，例如：${summary.bodyText.slice(0, 4).join('；')}。`,
      priority: 'P2',
      testType: '功能',
      notes: '该用例可帮助补齐页面规则说明、提示语和异常提示的验证。',
    });
  }

  return testCases;
}

function extractSections(bodyText) {
  const merged = [];
  for (const text of bodyText) {
    const trimmed = text.trim();
    if (!trimmed) continue;
    const lastIdx = merged.length - 1;
    if (lastIdx >= 0 && trimmed.length < 15
      && !/^[一二三三四五六七八九十]+[、．.]/u.test(trimmed)
      && !/^[一二三三四五六七八九十]+[、．.]/u.test(merged[lastIdx])
      && !/^\d{1,2}[.．]\d{1,2}/u.test(trimmed)
      && !/^\d{1,2}[.．]\d{1,2}/u.test(merged[lastIdx])) {
      merged[lastIdx] = merged[lastIdx] + ' ' + trimmed;
    } else {
      merged.push(trimmed);
    }
  }

  const sections = [];
  let current = null;

  const sectionHeaderPattern = /^[一二三三四五六七八九十]+[、．.]/u;
  const digitalHeaderPattern = /^\d{1,2}[.．]\d{1,2}([.．]\d{1,2})?\s/u;

  for (const trimmed of merged) {
    if (trimmed.length < 6 && !sectionHeaderPattern.test(trimmed) && !digitalHeaderPattern.test(trimmed)) continue;

    const isSectionHeader = sectionHeaderPattern.test(trimmed) || digitalHeaderPattern.test(trimmed);
    const isSubSection = digitalHeaderPattern.test(trimmed) && /^\d{1,2}[.．]\d{1,2}[.．]\d{1,2}/u.test(trimmed);

    if (isSectionHeader) {
      if (isSubSection && current) {
        current.requirements.push(trimmed);
      } else {
        current = { name: trimmed, requirements: [] };
        sections.push(current);
      }
    } else if (current && trimmed.length >= 6) {
      current.requirements.push(trimmed);
    } else if (!current && trimmed.length >= 6) {
      current = { name: '业务要求', requirements: [trimmed] };
      sections.push(current);
    }
  }

  return sections;
}

function isBusinessRule(text) {
  const RULE_PATTERNS = [
    /根据.*统计/u,
    /按.*统计/u,
    /按.*计算/u,
    /按.*匹配/u,
    /按.*分摊/u,
    /进行.*分摊/u,
    /优先/u,
    /若.*则/u,
    /将.*改为/u,
    /统一/u,
    /必须/u,
    /必填/u,
    /不能为空/u,
    /暂时不/u,
    /不得/u,
    /禁止/u,
    /兜底/u,
    /候选项目/u,
    /未匹配/u,
    /调差/u,
    /对账/u,
    /总金额/u,
    /按人数/u,
    /月末/u,
    /三级/u,
    /第一级/u,
    /第二级/u,
    /第三级/u,
    /对方账户/u,
    /人员明细/u,
    /归属到/u,
  ];
  return RULE_PATTERNS.some((pattern) => pattern.test(text));
}

function buildTestCasesFromBodyText(bodyText, moduleName, prefix) {
  const sections = extractSections(bodyText);
  if (sections.length === 0) return [];

  const cleanModuleName = stripModuleName(moduleName);
  const testCases = [];
  let index = 1;

  for (const section of sections) {
    for (const requirement of section.requirements) {
      if (!isBusinessRule(requirement)) continue;
      const short = requirement.length > 50 ? requirement.slice(0, 50).replace(/\s+/g, ' ') + '…' : requirement.replace(/\s+/g, ' ');
      testCases.push({
        id: `${prefix}-${String(index).padStart(3, '0')}`,
        module: cleanModuleName,
        scenario: section.name,
        title: `${cleanModuleName}${short}`,
        preconditions: `${moduleName}相关功能页面可正常访问且数据准备就绪。`,
        steps: [
          `进入${cleanModuleName}对应功能场景。`,
          `核对并验证需求内容：${requirement}`,
        ],
        expectedResult: `系统行为与需求一致：${requirement}`,
        priority: /必须|必填|不能|不得/u.test(requirement) ? 'P1' : 'P2',
        testType: '功能',
        notes: '基于 Mockplus 页面文本内容生成，建议结合正式需求确认后续细节。',
      });
      index += 1;
    }
  }

  return testCases;
}

function buildTextHeavyModuleJson(moduleName, summary, prefix) {
  const cleanModuleName = stripModuleName(moduleName);
  const testCases = buildTestCasesFromBodyText(summary.bodyText, moduleName, prefix);
  const sectionCount = extractSections(summary.bodyText).length;

  return {
    prefix,
    documentSummary: {
      name: `${moduleName} 文本内容测试分析`,
      type: 'mockplus-text',
      parseResult: `基于页面正文文本检测到 ${sectionCount} 个业务章节及 ${testCases.length} 条需求描述，已按章节结构生成测试用例。`,
      missingInfo: '文本解析基于正文内容的模式匹配，可能遗漏隐藏的交互逻辑或动态加载后的规则变更。',
    },
    requirementSummary: summary.bodyText.slice(0, 10).map((text) => {
      const trimmed = text.trim();
      return trimmed.length > 60 ? trimmed.slice(0, 60) + '…' : trimmed;
    }),
    openQuestions: [
      `${cleanModuleName}模块的权限控制、接口校验和异常分支仍需结合正式需求确认。`,
      '基于版面文本提取的业务章节可能不完整，建议根据实际页面交互补充遗漏场景。',
    ],
    testScope: summary.bodyText.slice(0, 8).map((text) => {
      const trimmed = text.trim();
      return trimmed.length > 50 ? trimmed.slice(0, 50) + '…' : trimmed;
    }),
    risks: [
      `${moduleName}模块页面无明确 UI 交互元素，当前用例完全依赖文本模式识别，若页面布局或文案调整需重新验证。`,
      '基于 Mockplus 自动抓取生成的测试用例仍需结合正式需求确认业务约束和异常分支。',
    ],
    testCases,
  };
}

function buildModuleJson(raw) {
  const moduleName = raw.module.name;
  const prefix = makePrefix(moduleName);
  const summary = summarizePages(raw);
  const cleanModuleName = stripModuleName(moduleName);

  if (isNotificationModule(moduleName, summary)) {
    const notificationModuleJson = buildNotificationModuleJson(raw, summary);
    if (notificationModuleJson) {
      return notificationModuleJson;
    }
  }

  const isTextHeavy = summary.labels.length === 0
    && summary.buttons.length === 0
    && summary.headers.length === 0
    && summary.bodyText.length > 4;
  if (isTextHeavy) {
    return buildTextHeavyModuleJson(moduleName, summary, prefix);
  }

  return {
    prefix,
    documentSummary: {
      name: `${moduleName} Mockplus模块测试分析`,
      type: 'mockplus-module',
      parseResult: `基于模块首页和${summary.pages.length > 1 ? '二层页面' : '首页'}的实际抓取内容整理，已识别页面标题、字段标签、按钮入口、列表列名、状态文案和业务说明。`,
      missingInfo: summary.pages.length > 1
        ? '已覆盖到第二层页面，但仍可能存在未触发的交互分支、动态弹窗或权限差异，需要后续补充。'
        : '当前仅抓到模块首页内容，若存在详情弹窗、分页切换或权限分支，仍需后续补充。',
    },
    requirementSummary: uniqueValues([
      `${moduleName}模块当前识别页面包括：${summary.pageNames.join('、')}。`,
      summary.headings.length > 0 ? `页面标题或章节包括：${summary.headings.slice(0, 6).join('、')}。` : '',
      summary.labels.length > 0 ? `页面字段或标签包括：${summary.labels.slice(0, 8).join('、')}。` : '',
      summary.buttons.length > 0 ? `页面操作入口包括：${summary.buttons.slice(0, 8).join('、')}。` : '',
      summary.headers.length > 0 ? `列表列或表头包括：${summary.headers.slice(0, 8).join('、')}。` : '',
      summary.statuses.length > 0 ? `状态或提示信息包括：${summary.statuses.slice(0, 8).join('、')}。` : '',
    ].filter(Boolean), 8),
    openQuestions: uniqueValues([
      summary.labels.length === 0 ? `尚未识别到${moduleName}模块明确的字段标签，可能存在动态加载或截图化页面。` : '',
      summary.buttons.length === 0 ? `尚未识别到${moduleName}模块明确的操作入口，需确认是否存在 hover、菜单或权限控制后才展示。` : '',
      summary.statuses.length === 0 ? `尚未识别到${moduleName}模块明确的状态流转信息，需补充状态定义和角色差异。` : '',
      `自动抓取内容仍无法完全确认${cleanModuleName}模块的字段校验规则、接口约束和权限矩阵。`,
    ].filter(Boolean), 6),
    testScope: uniqueValues([
      `${cleanModuleName}模块首页内容展示`,
      ...(summary.pages.length > 1 ? [`${cleanModuleName}模块二层页面内容展示`] : []),
      summary.labels.length > 0 ? `${cleanModuleName}字段与表单项展示` : '',
      summary.buttons.length > 0 ? `${cleanModuleName}关键操作入口与流程跳转` : '',
      summary.headers.length > 0 ? `${cleanModuleName}列表列和表格信息展示` : '',
      summary.statuses.length > 0 ? `${cleanModuleName}状态、提示与异常文案展示` : '',
    ].filter(Boolean), 8),
    risks: uniqueValues([
      summary.pages.length === 1 ? `${moduleName}模块暂未抓到二层页面内容，可能遗漏详情页或弹窗规则。` : '',
      summary.bodyText.length < 10 ? `${moduleName}模块可见正文有限，生成的测试点可能仍偏页面结构层。` : '',
      `基于 Mockplus 自动抓取生成的测试用例仍需结合正式需求确认业务约束和异常分支。`,
    ].filter(Boolean), 5),
    testCases: buildTestCases(moduleName, summary, prefix),
  };
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, 'utf8'));
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const entries = await fs.readdir(options.inputDir, { withFileTypes: true });
  const results = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const moduleDir = path.join(options.inputDir, entry.name);
    const rawPath = path.join(moduleDir, 'raw.json');
    try {
      const raw = await readJson(rawPath);
      if (!raw?.module || !raw?.rootPage) continue;
      const output = buildModuleJson(raw);
      const outputPath = path.join(moduleDir, 'testcases-input.json');
      await fs.writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
      results.push({ module: raw.module.name, outputPath });
    } catch {
      // Ignore non-module directories like the share summary root files.
    }
  }

  process.stdout.write(`${JSON.stringify({ inputDir: options.inputDir, results }, null, 2)}\n`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}

export { buildModuleJson, buildTestCasesFromBodyText };
