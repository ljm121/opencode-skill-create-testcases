import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSummary } from './fetch-and-summarize-design.mjs';

function toMd(lines) {
  return Array.isArray(lines) ? lines.join('\n') : lines;
}

test('buildSummary returns structured markdown from empty fetched data', () => {
  const fetched = {
    success: true,
    url: 'https://mockplus.test/share',
    modules: [],
    shareRaw: { networkText: [], domText: [] },
  };

  const lines = buildSummary(fetched);
  const md = typeof lines === 'string' ? lines : lines.join('\n');
  assert.ok(md.startsWith('#'));
});

test('buildSummary includes module names from fetched data', () => {
  const fetched = {
    success: true,
    url: 'https://mockplus.test/share',
    modules: [
      { module: { name: '请款调整' }, rootPage: {}, secondLayerPages: [], thirdLayerPages: [] },
      { module: { name: '认款逻辑调整' }, rootPage: {}, secondLayerPages: [], thirdLayerPages: [] },
    ],
    shareRaw: { networkText: [], domText: [] },
  };

  const md = toMd(buildSummary(fetched));
  assert.match(md, /请款调整/);
  assert.match(md, /认款逻辑调整/);
});

test('buildSummary categorizes business texts', () => {
  const fetched = {
    success: true,
    url: 'https://mockplus.test/share',
    modules: [
      {
        module: { name: '出款调整' },
        rootPage: {
          headings: [],
          labels: ['需求背景：当前分摊规则不准确'],
          buttons: ['确认'],
          bodyText: [
            '目前出款流水手续费分摊规则存在不准确的情况',
            '调整分摊规则为按人数比例分摊',
            '遇到无法匹配的兜底到候选项目',
          ],
          networkText: [],
          tableHeaders: [],
          statusTexts: [],
        },
        secondLayerPages: [],
        thirdLayerPages: [],
      },
    ],
    shareRaw: { networkText: [], domText: [] },
  };

  const md = toMd(buildSummary(fetched));
  assert.match(md, /需求背景/);
  assert.match(md, /分摊/);
  assert.match(md, /兜底/);
});

test('buildSummary handles fetched data that lacks module name', () => {
  const fetched = {
    success: true,
    url: 'https://mockplus.test/share',
    modules: [
      { module: null, rootPage: {}, secondLayerPages: [], thirdLayerPages: [] },
    ],
    shareRaw: { networkText: [], domText: [] },
  };

  const md = toMd(buildSummary(fetched));
  assert.ok(md.length > 0);
});

test('buildSummary returns failure array when success is false', () => {
  const fetched = {
    success: false,
    url: 'https://mockplus.test/share',
    modules: [],
    shareRaw: { networkText: [], domText: [] },
  };

  const lines = buildSummary(fetched);
  assert.ok(Array.isArray(lines));
  assert.match(lines[0], /失败/);
});
