---
name: create-testcases
description: Use when users provide uploaded files, local document paths, shared URLs, or pasted requirement text and need structured test cases exported as Markdown, Excel, and XMind files. Also when failing to generate systematic test cases from unstructured requirements, dealing with multi-module feature testing, or needing to export QA test plans with priority and scenario classification.
compatibility: opencode
metadata:
  audience: qa
  language: zh-CN
  input: document
  output: files
  domain: general-software
---

# 测试用例生成

## 概述

用于从需求文档或需求文本中提炼测试信息，并导出结构化测试用例文件。

这是当前工作区唯一保留的导出型测试用例生成 skill，目标是稳定产出真实的 `Markdown`、`Excel`、`XMind` 文件，而不是只在对话中整理测试点。

用户只需要提供路径、链接或文本内容；agent 应自行完成读取、解析、提炼和导出，而不是把命令行使用方法作为主要回复内容。

## 使用方式

### 标准流程（六步）

1. **提供输入** — 上传文件、提供本地路径、分享 URL 或粘贴需求文本
2. **分析需求** — Agent 读取并解析输入内容，提炼功能模块、场景分类、风险和待确认问题
3. **展示摘要** — Agent 将需求分析摘要展示给你，包含模块列表、用例概览、测试范围、风险提示和待确认问题
4. **用户确认** — 你审核分析摘要，确认无误或提出修改意见；如有修改，Agent 按反馈调整
5. **生成文件** — 确认后 Agent 构建结构化 JSON，通过 `export-testcases.ps1` 导出 Markdown、Excel、XMind 文件，文件名按业务范围命名（`{documentSummary.name}.md` 等）
6. **输出结果** — Agent 返回输出路径、模块分布、用例数量和产物状态

### 交互示例

```
你: （提供需求文本/文件/URL）
Agent: 展示分析摘要（模块 | P1 | 场景 | 风险 | 待确认）
你: 确认 / 修改某处
Agent: 生成并输出产物路径
```

## 适用场景

- 用户上传文件、提供本地路径、分享 URL（在线需求文档/PRD/设计稿），或直接粘贴需求文本，希望得到测试用例文件
- 需要从 `PDF`、`HTML`、`DOCX`、`DOC`、`MD`、`TXT` 及在线网页中提炼需求并生成测试用例
- 同一个文件中的多模块内容，或同一目录下同主题内容，希望合并为一套总测试清单导出
- 需要在最终回复里给出真实输出路径和处理结果摘要
- 需要三种产物在测试语义和字段口径上保持一致

## 不适用场景

- 用户只是在讨论测试思路、询问测试策略，不需要导出文件
- 需求描述过于模糊，功能模块和预期结果都不明确，应先澄清再生成
- 用户已有现成测试用例（如 Excel），只需要格式转换 —— 这是文件格式转换，不是测试用例生成
- 用户需要的是代码层面的测试覆盖（如单元测试），而非业务功能测试

## 能力范围

- 识别并分析需求文档、附件、在线网页和纯文本内容
- 通过 `webfetch` 获取 URL 内容，解析 HTML/Markdown 并提取结构化需求
- 支持通过本地文件路径或目录路径直接读取输入内容
- 归纳测试范围、风险、待确认问题和结构化测试用例
- 如用户提供历史测试用例路径，读取历史 `.md`、`.xlsx`、`.xmind`、`.json` 并分析影响范围
- 按功能模块与场景导出 `Markdown`、`Excel`、`XMind` 三类测试用例文件
- 对单文件输入、单 URL 输入或单目录输入，默认按合并方式生成一套总测试清单，同时在文件内容中保留模块分组

## 快速参考

| 输入类型 | Agent 读取方式 | 需先确认 | 导出方式 | 输出文件名 |
|---|---|---|---|---|
| 本地文件 | `InputPath`（传路径） | 是 | 默认合并 | `{documentSummary.name}` |
| 本地目录 | `InputPath`（传目录） | 是 | 默认合并 | `{documentSummary.name}` |
| URL | `webfetch` 获取内容 → 构造 JSON | 是 | 默认合并，记录 url 来源 | `{documentSummary.name}` |
| 粘贴文本 | Agent 直接解析 → 构造 JSON | 是 | 默认合并 | `{documentSummary.name}` |
| Mockplus | `fetch-mockplus-content.mjs` | 是 | 默认合并 | `{documentSummary.name}` |
| 历史用例 | `-HistoryPath`（显式传历史文件或目录） | 是 | 仅辅助影响范围分析 | 不单独导出 |

## 工作流程（强制确认）

无论输入方式是什么（文件/URL/文本/Mockplus），agent 必须分两步执行：

1. **分析并展示** — 读取输入内容后，先整理需求分析摘要，展示给用户。摘要至少包含：
   - 功能模块列表及各模块用例概览（数量、P1 数量）
   - 测试范围
   - 风险提示
   - 历史影响范围（当用户提供历史用例路径时）
   - 待确认问题
2. **确认后生成** — 用户确认分析摘要后，再执行导出。用户如有修改意见，按反馈调整后再生成。

> 脚本层提供 `-Preview` 开关支持预览模式。agent 可以在构建完结构化 JSON 后用预览模式输出分析摘要，而无需先生成文件。

## 输出命名

- **合并模式（默认）**：文件名取自 `documentSummary.name`，例如 `IC PayLink 客户账单管理.md`
- **拆分模式（传 `-SplitByModule`）**：按模块拆分为子目录，文件名统一为 `testcases.md`

## 摘要模板

> **摘要格式为强制要求**。agent 在生成测试用例前必须按此模板输出分析摘要，并等待用户确认后才能继续。不得自行跳过此步骤。

展示给用户的分析摘要应使用固定模板：

```markdown
## 需求分析摘要

输入来源：<文件路径 / URL / 粘贴文本>
功能模块：
- <模块A>（预计 X 条用例，P1: X 条）
- <模块B>（预计 X 条用例，P1: X 条）

测试范围：
- <范围说明>

风险提示：
- <风险说明>

历史影响范围：
- <受影响模块 / 关联历史用例 / 回归风险；未提供历史路径时可省略>

待确认问题：
1. <问题说明>

导出方式：合并导出 / 按模块拆分
---
请确认以上分析是否可以生成测试用例文件。
```

## JSON 输入结构

当通过 Agent 构造数据传给导出脚本时，`InputJsonText` 必须符合以下结构：

```json
{
  "prefix": "SUPPLOGIC",
  "documentSummary": {
    "name": "出款流水手续费分摊",
    "type": "docx-requirement",
    "parseResult": "已提取自营请款、承包商请款两个主体需求",
    "missingInfo": "未覆盖精度舍入规则"
  },
  "requirementSummary": [
    "自营请款：按项目维度去重关联出款单"
  ],
  "testScope": ["自营请款 - 手续费统计逻辑"],
  "risks": ["金额精度规则仅有模糊描述"],
  "openQuestions": ["当前月统计口径是自然月还是账单月？"],
  "testCases": [
    {
      "module": "自营请款-手续费统计",
      "scenario": "正向统计",
      "title": "按项目筛选自营请款单，去重关联出款单并获取出款流水",
      "steps": [
        "进入手续费统计功能页面",
        "选择一个有自营请款记录的项目",
        "查看系统是否根据项目下自营请款单关联对应的出款单",
        "验证出款单关联到的出款流水是否展示在结果中"
      ],
      "expectedResult": "系统正确找出当前项目下所有自营请款单，展示对应的出款流水",
      "priority": "P1",
      "testType": "功能"
    }
  ]
}
```

字段说明：

| 字段 | 类型 | 说明 |
|---|---|---|
| `prefix` | string | 可选，用例编号前缀 |
| `documentSummary.name` | string | 业务范围名称，用于合并模式下输出文件名 |
| `documentSummary.type` | string | 输入源类型标识 |
| `documentSummary.parseResult` | string | 解析结果摘要 |
| `documentSummary.missingInfo` | string | 未覆盖或缺失的信息 |
| `requirementSummary` | string[] | 需求点列表 |
| `testScope` | string[] | 测试覆盖范围 |
| `risks` | string[] | 风险提示列表 |
| `openQuestions` | string[] | 待确认问题列表 |
| `testCases[].module` | string | 所属功能模块 |
| `testCases[].scenario` | string | 所属场景分类 |
| `testCases[].title` | string | 用例标题，应具体表达测试意图 |
| `testCases[].steps` | string[] | 测试步骤 |
| `testCases[].expectedResult` | string | 预期结果，必须可验证 |
| `testCases[].priority` | string | P1/P2/P3 |
| `testCases[].testType` | string | 功能/异常/边界/兼容/性能等 |
| `historyContext` | object | 可选，历史用例影响范围分析结果 |
| `historyContext.sources` | object[] | 历史用例来源文件及解析状态 |
| `historyContext.impactedModules` | object[] | 受影响模块、关联历史用例数量和标题 |
| `historyContext.relatedCases` | object[] | 当前用例与历史用例的关联关系 |
| `historyContext.regressionRisks` | string[] | 建议重点回归的风险点 |
| `historyContext.unmatchedRequirements` | string[] | 未匹配到历史用例的当前需求 |
| `testCases[].historyImpact` | string | 可选，该用例命中的历史影响范围说明 |
| `testCases[].relatedHistoryCases` | string[] | 可选，该用例关联的历史用例标题 |

## 输出结构

最终测试用例默认采用统一字段结构，包括：

- `功能模块`
- `场景分类`
- `用例标题`
- `测试步骤`
- `预期结果`
- `优先级`
- `测试类型`

当存在历史影响范围时，还会在 Excel/Markdown 用例表中追加：

- `影响范围`
- `关联历史用例`

## 关键规则

- 所有输入方式默认合并导出为一套文件，按业务范围命名
- 如需按模块拆分为独立子目录，后续可重新导出
- 当用户提供 URL 时，agent 应使用 `webfetch` 获取网页内容，解析为纯文本或结构化数据后再生成测试用例
- 脚本层提供 `-InputUrl` 参数支持：单独使用时输出 agent 桥接指引；配合 `-InputJsonText` 使用时将 URL 记录为输入来源（详见脚本对应 `-InputUrl` 参数说明）
- agent 不得在展示需求分析摘要并获得用户确认前调用导出流程，不得跳过确认步骤直接生成文件
- 当用户已提供本地路径、URL、目录路径或文件内容时，默认由 agent 直接读取、解析并生成产物，不应把命令调用示例作为主要回复内容
- 当用户提供历史用例文件或目录时，agent 应通过 `-HistoryPath` 显式传入历史来源；不得默认扫描 `exports/` 当作历史用例来源
- 历史影响范围用于辅助生成和回归评审，不得自动删除或覆盖当前需求生成的新用例
- agent 不得在 skill 根目录生成调试中间产物，不得复制用户输入文档为 `temp_doc.docx`，不得生成 `extracted_content.txt`、`补充逻辑-提取内容.txt` 等调试提取文件
- `DOCX` 解析应使用脚本内置的内存读取逻辑；`DOC` / `PDF` 解析应使用 Office COM 只读读取。除用户明确确认外，不得为了调试额外落盘输入副本或提取文本
- 除最终导出的 `{业务范围名称}.md`、`{业务范围名称}.xlsx`、`{业务范围名称}.xmind` 外，不应生成额外文件；最终产物只允许写入 `exports/` 或用户指定的输出目录
- 即使做合并导出，也要在文件内容中保留功能模块分组
- 用例标题应具体表达测试意图，避免退化为泛化描述
- 预期结果必须可验证，能够对应界面状态、提示信息、数据结果、权限结果或状态变化
- 三种导出格式应表达同一批测试语义，不应出现字段口径不一致

## 输出结果

输出结果包括：

- `{业务范围名称}.md`
- `{业务范围名称}.xlsx`
- `{业务范围名称}.xmind`

三种格式分别用于：

- `Markdown`：阅读、评审与快速确认
- `Excel`：执行、流转与管理
- `XMind`：按功能模块与场景浏览、拆解与展示

## 常见问题

| 问题 | 处理方式 |
|---|---|
| PDF/DOC 解析失败 | 确认本机安装了 Microsoft Word COM 环境；DOC 文件并非所有环境都支持提取 |
| URL 无法访问 | 提示用户检查链接是否公开，或让用户手动粘贴文本内容 |
| 用户未确认就要求生成 | agent 应坚持先展示摘要，不得跳过确认步骤直接导出 |
| 输出目录已存在 | 脚本自动覆盖同名文件，不提示用户 |
| 文件名含非法字符 | 导出脚本自动替换为下划线，不影响生成 |
| 用例标题太泛化 | Agent 应确保标题表述具体测试意图，而非仅描述步骤 |
| 预期结果不可验证 | Agent 应确保预期结果对应界面状态、提示信息或数据变化 |

## 最终回复

最终回复应明确：

- 输入来源
- 输出目录或模块目录
- 本次是否为合并导出
- 成功项和失败项
- 关键风险
- 待确认问题

若输入源已可直接解析，最终回复应聚焦处理结果与输出文件，不应以“如何执行命令”作为主内容。
