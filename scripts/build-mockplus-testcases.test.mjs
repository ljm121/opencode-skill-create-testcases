import test from 'node:test';
import assert from 'node:assert/strict';

import { buildModuleJson, buildTestCasesFromBodyText } from './build-mockplus-testcases.mjs';

test('notification pages derive scenarios from top descriptions and sending cases', () => {
  const raw = {
    module: { name: '邮件通知中心' },
    rootPage: {
      name: '邮件通知中心',
      headings: ['企业邀请承包商签约合同', '承包商合同即将到期'],
      labels: ['签约通知'],
      buttons: ['立即查看'],
      tableHeaders: [],
      statusTexts: [],
      bodyText: [
        '企业邀请承包商签约合同',
        '企业邀请承包商签约合同，请尽快查看并完成签署。',
        '承包商合同即将到期',
        '合同将在 7 天后到期，请及时处理。',
      ],
    },
    secondLayerPages: [],
  };

  const result = buildModuleJson(raw);

  assert.equal(result.testCases.length, 2);
  assert.deepEqual(result.testCases.map((item) => item.scenario), [
    '企业邀请承包商签约合同',
    '承包商合同即将到期',
  ]);
  assert.ok(result.testCases.every((item) => item.title.includes('发送')));
  assert.ok(result.testCases.every((item) => item.scenario !== '页面展示'));
  assert.ok(result.testCases.every((item) => item.scenario !== '正文说明'));
});

test('text-heavy pages generate structured test cases from bodyText content', () => {
  const raw = {
    module: { name: '手续费统计' },
    rootPage: {
      name: '手续费统计',
      headings: [],
      labels: [],
      buttons: [],
      tableHeaders: [],
      statusTexts: [],
      bodyText: [
        '一、手续费统计逻辑',
        '根据项目，找出当前项目下所有的自营请款关联的出款单。',
        '根据出款流水的交易时间，统计当前月的出款手续费数据。',
        '二、手续费分摊规则',
        '优先按对方账户名称加币种加金额唯一匹配人员明细ID。',
        '若无法唯一匹配，则按金额加币种唯一匹配。',
        '三、手续费调差',
        '暂时不考虑手续费调差',
      ],
    },
    secondLayerPages: [],
  };

  const result = buildModuleJson(raw);

  assert.equal(result.testCases.length, 4, `should generate 4 business-rule cases, got ${result.testCases.length}`);
  assert.ok(result.testCases.some((t) => t.scenario.includes('统计')), 'should detect 统计逻辑 section');
  assert.ok(result.testCases.some((t) => t.scenario.includes('分摊')), 'should detect 分摊规则 section');
  assert.ok(result.testCases.some((t) => t.scenario.includes('调差')), 'should detect 调差 section');
  assert.equal(result.documentSummary.type, 'mockplus-text');
});

test('buildTestCasesFromBodyText filters background text and keeps business rules', () => {
  const bodyText = [
    '一、手续费统计逻辑',
    '跟财务沟通后，决定调整手续费统计方式。',
    '当前自营请款场景中存在重复关联的问题。',
    '根据出款流水的交易时间，统计当前月的出款手续费数据。',
    '目前抽样发现部分数据存在差异。',
    '二、分摊规则',
    '优先按对方账户名称和币种和金额进行匹配。',
    '经过分析，分摊逻辑较为复杂。',
    '若无法匹配，则按金额加币种进行兜底匹配。',
  ];

  const result = buildTestCasesFromBodyText(bodyText, '手续费管理', 'FEE');

  assert.equal(result.length, 3, `should generate 3 business-rule cases, got ${result.length}`);
  assert.ok(result.some((t) => t.title.includes('根据出款流水')), 'should keep 统计 rule');
  assert.ok(result.some((t) => t.title.includes('优先按对方账户')), 'should keep 匹配 rule');
  assert.ok(result.some((t) => t.title.includes('若无法匹配')), 'should keep 兜底 rule');
});

test('text-heavy page with no UI elements bypasses generic scenarios', () => {
  const raw = {
    module: { name: '出款管理' },
    rootPage: {
      name: '出款管理',
      headings: [],
      labels: [],
      buttons: [],
      tableHeaders: [],
      statusTexts: [],
      bodyText: [
        '统计规则',
        '按客户名称和费用类型统计当月手续费。',
        '按出款流水交易时间统计当月手续费。',
        '分摊规则',
        '按未匹配人数进行兜底分摊。',
      ],
    },
    secondLayerPages: [],
  };

  const result = buildModuleJson(raw);

  assert.ok(result.testCases.length >= 2, `should generate cases from text, got ${result.testCases.length}`);
  assert.equal(result.documentSummary.type, 'mockplus-text');
  assert.ok(result.testCases.every((t) => t.scenario !== '内容展示'), 'should not use generic 内容展示 scenario');
  assert.ok(result.testCases.every((t) => t.scenario !== '字段展示'), 'should not use generic 字段展示 scenario');
});

test('non-notification pages still use generic page scenarios', () => {
  const raw = {
    module: { name: '客户管理' },
    rootPage: {
      name: '客户管理',
      headings: ['客户管理'],
      labels: ['客户名称', '客户编码'],
      buttons: ['新建客户'],
      tableHeaders: ['客户名称', '状态'],
      statusTexts: ['启用'],
      bodyText: ['查看客户信息并维护客户资料。'],
    },
    secondLayerPages: [],
  };

  const result = buildModuleJson(raw);

  assert.ok(result.testCases.some((item) => item.scenario === '字段展示'));
  assert.ok(result.testCases.some((item) => item.scenario === '操作入口'));
  assert.ok(result.testCases.every((item) => !item.title.includes('发送')));
});
