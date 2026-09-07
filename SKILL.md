---
name: create-testcases
description: Use when users provide uploaded files, local document paths, shared URLs, pasted requirement text, unstructured product notes, or requests based on IMA knowledge base / notes, and need structured QA test cases exported as Markdown, Excel, and XMind files. Proactively supports searching and retrieving requirement documents from IMA knowledge base / notes via ima-skill to generate test cases based on existing documentation. Use for generating systematic business-function test cases, multi-module QA plans, priority/scenario-classified cases, and XMind outputs in historical readable business-tree or operation-template style using real fields, filters, buttons, and test points.
---

# 测试用例生成

## 概述

从需求文档、目录、URL、设计稿摘要、粘贴文本，**或通过 `ima-skill` 自动检索获取的 IMA 知识库/笔记文档**中提炼业务功能测试用例，并导出真实的 `Markdown`、`Excel`、`XMind` 文件。

用户提供路径、链接、文本或指定业务功能后，agent 要自行读取/检索、解析、提炼、确认和导出；最终回复聚焦产物路径和处理结果，不把命令行说明当作主体内容。

## 标准流程

1. 读取/检索输入：支持本地文件、目录、URL、Mockplus 内容、粘贴文本，**以及自动通过 `ima-skill` 在 IMA 知识库/笔记中检索获取已有需求文档**。
2. 分析需求：在已有文档或输入材料基础上，归纳功能模块、业务操作、字段/筛选项/按钮、测试范围、风险和待确认问题。
3. 展示摘要：按固定摘要模板让用户确认；用户已明确要求直接实施时，也要至少先给出可核对的分析摘要。
4. 生成结构化 JSON：保留 Markdown/Excel 所需字段，并为 XMind 补充 `xmindOperations` 或 `xmindTree`。
5. 调用 `scripts/export-testcases.ps1` 导出三类文件。
6. 汇报结果并主动发起 IMA 知识库归档确认：说明输入来源（含知识库文档来源）、输出目录、成功项，并在文末主动向用户发起知识库归档确认（支持独立新文件或合并演进）。

## 强制摘要模板

当仅基于纯新需求时输出第一部分；**当联动了 IMA 知识库已有文档作为设计基线时，必须同时输出第一部分与第二部分（增量差异矩阵 Diff）**：

```markdown
## 需求分析与增量差异综合评审

### 第一部分：需求分析摘要

输入来源：<文件路径 / URL / 粘贴文本 / IMA 知识库条目>
功能模块：
- <模块A>（预计 X 条用例，P1: X 条）
- <模块B>（预计 X 条用例，P1: X 条）

业务操作：
- <列表 / 新增 / 编辑 / 删除 / 详情 / 其他业务动作>

测试范围：
- <范围说明>

风险提示：
- <风险说明>

待确认问题：
1. <问题说明>

### 第二部分：增量差异矩阵（Diff）

```text
🟢 新增对象/字段 (Added)       : X 项
🟡 变更逻辑/校验规则 (Modified) : Y 项
🔵 需重点回归模块 (Regression) : Z 项
⚪ 保持原样基线 (Unchanged)    : N 项
```

| 对象/节点 | 差异分类 | 历史基线规范（As-Is） | 本次变更规范（To-Be） | 测试断言与影响 |
|---|---|---|---|---|
| <对象A> | 🟢 Added | <基线规范> | <新规范> | <测试关注点> |
| <对象B> | 🟡 Modified | <基线规范> | <新规范> | <测试关注点> |
| <对象C> | 🔵 Regression | <基线规范> | <新规范> | <测试关注点> |

导出方式：合并导出 / 按模块拆分
---
请确认以上分析与增量差异是否可以生成测试用例文件。
```

## JSON 输入结构

传给 `export-testcases.ps1` 的 `InputJsonText` 使用以下结构。`testCases` 是 Markdown/Excel 的主数据；`xmindOperations` 是推荐的 XMind 业务操作结构；`xmindTree` / `xmindNodes` 仍可用于完全自定义树。

```json
{
  "prefix": "SUPPLOGIC",
  "documentSummary": {
    "name": "客户联系人管理",
    "type": "docx-requirement",
    "parseResult": "已提取列表、新增、编辑、删除、详情操作",
    "missingInfo": ""
  },
  "requirementSummary": ["客户联系人支持维护手机号和邮箱"],
  "testScope": ["联系人列表与维护操作"],
  "risks": [],
  "openQuestions": [],
  "testCases": [
    {
      "module": "客户联系人管理",
      "scenario": "新增",
      "title": "新增联系人时校验手机号并保存成功",
      "steps": ["进入联系人列表", "点击新增", "填写手机号", "点击保存"],
      "expectedResult": "联系人保存成功，列表展示新数据",
      "priority": "P1",
      "testType": "功能"
    }
  ],
  "xmindOperations": [
    {
      "operation": "新增",
      "preconditions": ["当前用户有新增权限"],
      "entry": ["联系人列表点击新增"],
      "fields": [
        { "name": "手机号", "testPoints": ["填写规则", { "title": "格式校验", "children": ["错误时提示手机号格式不正确"] }] }
      ],
      "buttons": [
        { "name": "保存", "testPoints": [{ "title": "点击按钮后的校验", "children": ["数据校验", "状态校验"] }] }
      ]
    }
  ]
}
```

字段说明：

| 字段 | 类型 | 说明 |
|---|---|---|
| `documentSummary.name` | string | 业务范围名称，用于合并模式文件名和 XMind 根节点 |
| `testCases[]` | object[] | Markdown/Excel 主数据，也用于 XMind 兜底生成 |
| `xmindOperations[].operation` | string | 业务操作节点，如列表、新增、编辑、删除、详情或真实业务动作 |
| `xmindOperations[].fields[]` | object[] | 从需求中读取的真实字段名，替换模板中的 `[字段]` |
| `xmindOperations[].buttons[]` | object[] | 从需求中读取的真实按钮名，替换模板中的 `[按钮]` |
| `xmindOperations[].filters[]` | object[] | 从需求中读取的真实筛选项，替换模板中的 `[筛选项]` |
| `testPoints[]` | string[] / object[] | 替换模板中的 `{测试点}`；对象可继续带 `children` 生成子节点 |
| `xmindTree` / `xmindNodes` | object[] / object | 可选完全自定义 XMind 树，存在时按树输出 |

## XMind 生成规则

生成 XMind 前优先读取 `references/xmind-operation-template-style.md`；需要历史 GEO 脑图读法时再参考 `references/xmind-readable-tree-style.md`。

- 默认按“业务操作 -> 对象 -> 测试点”生成，不按固定一级/二级/三级层级生成。
- `[]` 只表示占位符，必须替换成需求里的真实字段、按钮、筛选项或入口名称；输出中不要保留中括号。
- `{}` 只表示测试点类型，必须改写成具体可执行测试点；输出中不要保留花括号。
- 生成前先读取 `templates/测试用例生成大规则.xmind`；遇到列表、详情、新增、编辑类操作时，再读取对应 `templates/列表-示例.xmind`、`templates/查看详情-示例.xmind`、`templates/新增-示例*.xmind`、`templates/编辑-示例*.xmind`，按示例的颗粒度补全不同操作的测试点。
- 对列表类操作生成数据范围/来源、字段内容、字段空值与格式、条件展示、操作列、筛选、排序、分页等测试点；没有明确权限要求时不要硬写权限控制节点。
- 对新增/编辑类操作生成入口、字段填写/显示/可修改规则、默认值、必填/格式/范围校验、联动清空/二次确认、保存后数据/状态校验；只有需求明确存在前置条件或操作按钮时才生成对应节点。
- 对删除/详情类操作生成入口、二次确认、字段展示、数据校验等测试点；详情页重点写字段取值、空值展示、链接跳转、条件分组/tab、可见性和页面动作。
- 对模板未覆盖的业务操作，根据操作语义补充相近测试点，不强行套入列表/新增/编辑/删除/详情。
- 当需求明确给出不符合预期时的提示或表现时，在对应最后一级测试点下继续生成子节点，例如 toast 文案、字段红字提示、按钮置灰、弹窗保持/关闭、页面不可访问、数据不变化等；没有明确提示或表现时不要硬加子节点。
- 优先级和测试类型默认留在 Markdown/Excel 中；只有当它们本身是业务判断或筛选条件时，才作为 XMind 节点出现。

## IMA 知识库联动机制（自动检索与内容获取）

当生成用例时需要基于已有系统文档、用户指定了知识库/笔记，或用户输入业务功能名称时，**agent 应自动通过 `scripts/ima-bridge.mjs` 联动检索 IMA 知识库或笔记中的已有文档作为需求基线**：

1. **自动检索定位**：
   - 快速调用 `node scripts/ima-bridge.mjs search-kb <知识库名>` 定位目标知识库。
   - 调用 `node scripts/ima-bridge.mjs search <知识库名> --query <业务关键词>` 检索库内文件和脑图。
   - 或直接调用 `node scripts/ima-bridge.mjs fetch-baseline <知识库名> --query <业务关键词>` 一键获取解析后的业务测试基线 Markdown。
2. **提取文档内容**：
   - XMind 思维导图（`media_type=14`）：`ima-bridge.mjs` 内置原生轻量解压器，自动在内存中解压并递归转换为树状 Markdown。
   - 个人笔记/文档（`media_type=11`）：自动调用 `openapi/note/v1/get_doc_content` 读取正文纯文本。
3. **基于已有文档融合生成**：
   - 将知识库提取出的已有功能规范、字段规则与用户本次提供的新增诉求进行结合。
   - 在已有文档基线之上全面覆盖正向流程、字段校验、状态流转、边界条件与异常分支。
4. **来源记录与追踪**：
   - 在 `documentSummary.parseResult`、`requirementSummary` 以及“需求分析摘要”的“输入来源”中明确注明所参考的 IMA 知识库条目或笔记名称，确保用例可追溯。

## 在线原型（Mockplus）抓取规范与沙箱自洁

1. **沙箱隔离与即时清理**：
   - 抓取脚本 `scripts/fetch-mockplus-content.mjs` 未传 `--output-dir` 时默认采用系统临时沙箱目录（`os.tmpdir()`）。
   - 必须通过 `--cleanup` 标志或在用例生成完成后在代码层立即彻底清理抓取临时目录，严禁在 `exports/` 残留中间缓存。
2. **目录分组与草稿过滤**：
   - 支持 `--group <名称>`：精准指定仅抓取目标业务分组（例如 `--group "系统小优化"`）。
   - 支持 `--exclude-group <名称>`：自动过滤草稿脏数据（例如 `--exclude-group "草稿"`）。

## IMA 知识库双向归档（Push Baseline 双策略）

测试用例导出并通过评审后，可通过 `scripts/ima-bridge.mjs push` 一键反哺归档到 IMA 知识库，提供两种灵活策略：

1. **策略一：独立新版本文件归档（`--mode new-file`，默认推荐）**：
   - 示例：`node scripts/ima-bridge.mjs push "geo全功能用例" --file "exports/V4.8.2系统小优化测试用例/V4.8.2系统小优化测试用例.xmind" --mode new-file`
   - 效果：在知识库中保存为独立的新文件，保持历史基线完整与改动可追溯。
2. **策略二：合并演进至原脑图（`--mode merge`）**：
   - 示例（单模块指定目标）：`node scripts/ima-bridge.mjs push "geo全功能用例" --file "exports/.../用例.xmind" --mode merge --target-media-id "<原xmind_id>" --version-tag "V4.8.2"`
   - 示例（多模块自动匹配批量合并）：`node scripts/ima-bridge.mjs push-batch "geo全功能用例" --file "exports/.../用例.xmind" --version-tag "V4.8.2"`
   - 效果：智能拆解各大子模块，自动在知识库中检索高置信度历史基线脑图并定向合并，无需人工一个个输入 `target-media-id`。可加 `--dry-run` 预览匹配结果。
3. **文件归档命名规则**：
   - 归档入库的文件名必须严格遵循**原文件名或带有版本号**（例如：原脑图名 `商务合同审批详情.xmind`，或带版本号 `商务合同审批详情_V4.8.2.xmind`、`V4.8.2系统小优化测试用例.xmind`）。
   - 严禁在知识库中使用 `_merged.xmind` 等内部临时命名称谓，确保知识库资产整洁规范。

## 跨平台容器化导出引擎（纯 Node.js 实现）

除 Windows 专用的 `export-testcases.ps1` 外，新增纯 Node.js 原生跨平台导出器 `scripts/export-testcases.mjs`：
- **零外部 npm 依赖**：内置原生 ZIP、OpenXML Excel、XMind 打包引擎。
- **全平台支持**：支持在 Windows、macOS、Linux、Docker 容器与 CI/CD 流水线中无差别执行。
- **调用方式**：
  ```bash
  node scripts/export-testcases.mjs --input-json-text '<JSON>' --output-dir 'exports/模块名'
  ```

## 导出与命名

- 默认合并导出一套 `{documentSummary.name}.md/.xlsx/.xmind`。
- 传 `-SplitByModule` 时按模块拆分子目录，文件名统一为 `testcases.*`。
- 最终产物只写入 `exports/` 或用户指定输出目录；不要在 skill 根目录生成调试中间文件。
- 即使合并导出，也要在 Markdown/Excel 内容中保留模块分组。

## 关键规则

- 所有输入方式默认合并导出，除非用户明确要求按模块拆分。
- 当用户要求为某个功能生成用例且未提供完整本地文件时，或明确要求参考已有文档时，**自动优先通过 `ima-skill` 搜索知识库和笔记，检索相关已有文档作为测试分析基础**。
- URL 输入需要先获取网页内容并解析成结构化数据；脚本的 `-InputUrl` 只负责记录来源和桥接提示。
- `DOCX` 使用脚本内置内存读取；`DOC` / `PDF` 使用 Office COM 只读读取。除用户明确确认外，不落盘输入副本或提取文本。
- 用例标题必须表达具体测试意图，预期结果必须可验证，对应界面状态、提示信息、数据结果、权限结果或状态变化。
- Markdown、Excel、XMind 表达同一批测试语义，但 XMind 的组织方式应服务扫读和拆解，不强行保持表格字段形态。

## 最终回复与知识库归档确认引导

最终回复明确输入来源（包括检索到的 IMA 知识库文档/笔记）、输出目录、是否合并导出、成功项、失败项、关键风险和待确认问题。

**归档策略推荐决策规则**：
- **常规单一功能 / 局部小迭代**：默认推荐【选项 A】（独立新文件归档），保持版本边界清晰。
- **跨系统 / 大迭代变更**：**如果一次迭代改动跨度较大、跨越多个业务子系统，需长期维护单模块的活文档测试基线，推荐采用方案 2（按模块拆分定向合并）**，引导用户分别合并至各子系统的历史基线中。

**若测试用例产物已成功生成，Agent 必须在最终回复结尾处主动发起【IMA 知识库归档确认】引导**：
```markdown
---
### 知识库双向归档确认
本次测试用例已成功生成并保存在本地。是否需要将测试资产同步归档至 IMA 知识库（如：`<目标知识库名>`）？
1. **选项 A**：归档为独立新版本文件（`--mode new-file`，如 `<版本>测试用例.xmind`），保持版本独立与改动可追溯。（适合单功能小迭代）
2. **选项 B**：合并演进至原脑图（`--mode merge`），按模块拆分定向合并融入原脑图同名分支，维护单模块全量活文档。（适合改动跨度大、涉及多子系统需长期维护基线的场景）
3. **选项 C**：暂不归档，仅保留本地导出产物。
```
当用户做出选择后，Agent 调用 `scripts/ima-bridge.mjs push` 自动执行归档入库。


