# 测试用例生成 skill

这个 skill 用来把需求材料直接整理成真实的测试用例文件。

## 你需要提供什么

- 本地单文件路径
- 本地目录路径
- 在线需求文档 URL（Confluence、PRD 链接、共享文档等）
- 粘贴的需求文本

## 它会做什么

- 读取并解析你提供的内容（包括通过 URL 获取在线内容）
- 提炼功能模块、场景分类、测试范围、风险和待确认问题
- 生成三类文件：`{业务范围名称}.md`、`{业务范围名称}.xlsx`、`{业务范围名称}.xmind`（按业务命名，而非统一 testcases）

## 默认处理方式

- 单个文件：默认合并生成一套测试用例
- 同一目录：默认合并生成一套测试用例
- 单个 URL：默认合并生成一套测试用例
- 多个离散路径（含混合 URL+文件）：先按内容关联性判断是否应该合并；判断不稳定时先确认
- 即使合并生成，也会在内容中保留功能模块分组

## 适合什么场景

- 你已经有需求文档、页面说明或功能文本
- 你希望直接得到测试用例文件，而不是只在对话里讨论测试点
- 你希望输出同时覆盖阅读、执行和结构化展示三种用途

## 支持的输入类型

- 文档与文本：`MD`、`TXT`、`HTML`、`HTM`、`DOCX`、`DOC`、`PDF`
- 在线内容：通过 URL 获取的网页、在线文档或共享链接
- 结构化测试数据：`JSON`

## 输出内容

最终测试用例默认包含这些字段：

- `功能模块`
- `场景分类`
- `用例标题`
- `测试步骤`
- `预期结果`
- `优先级`
- `测试类型`

## 使用方式

可直接复制使用（替换为你的实际内容）：

文件输入：
```text
请使用 create-testcases，读取以下文件，先梳理需求点给我确认，确认后再生成测试用例：C:\需求文档.docx
```

目录输入：
```text
请使用 create-testcases，读取以下目录，先梳理需求点给我确认，确认后再生成测试用例：C:\需求目录\
```

URL 输入：
```text
请使用 create-testcases，读取以下 URL，先梳理需求点给我确认，确认后再生成测试用例：https://example.com/prd
```

文本输入：
```text
请使用 create-testcases，根据以下需求文本，先梳理需求点给我确认，确认后再生成测试用例：<粘贴需求文本>
```

### URL 输入机制

URL 输入采用 **agent 桥接**方式工作：

1. agent 使用 `webfetch` 获取 URL 内容
2. agent 将内容解析为结构化测试用例 JSON
3. 通过 `-InputUrl` + `-InputJsonText` 参数传给导出脚本
4. 导出结果的 `inputJson` 字段会记录原始 URL 来源

**脚本参数说明：**

| 参数模式 | 行为 |
|---|---|---|
| `-InputUrl <url>`（单独） | 输出 agent 桥接指引信息，指导 agent 下一步操作 |
| `-InputUrl <url> -InputJsonText '<json>'` | 正常导出，且 `inputJson` 字段记录为 `url:<url>` |
| `-Preview`（开关参数） | 预览模式，只输出分析摘要 JSON 到 stdout，不生成任何文件 |

## 环境与维护

### 迁移清单

1. 复制整个 `create-testcases` 目录，不要只复制 `scripts/`
2. 至少确认这些内容一起带走：`package.json`、`scripts/`、`templates/default-template.xmind`
3. 新电脑需要：`Node.js >= 20`、Windows PowerShell
4. 如果要解析 `DOC` / `PDF`，还需要本机可用的 Microsoft Word COM 环境
5. 进入 skill 根目录后执行：

```powershell
npm install
node .\scripts\verify-runtime.mjs
```

6. 或直接执行：

```powershell
powershell -ExecutionPolicy Bypass -File ".\scripts\setup-runtime.ps1"
```

7. 迁移完成后再运行：

```powershell
node .\scripts\verify-runtime.mjs
npm test
```

8. 最后做一次最小验证：
   - 一次本地文件输入
   - 一次 URL 输入（可选：验证 webfetch 流程）

### OpenCode 自动识别

- 如果只是本地运行脚本，目录放哪里都可以
- 如果希望 OpenCode 自动识别成 skill，建议把目录放到新电脑工作区的：

```text
<workspace>\.opencode\skills\create-testcases\
```

- 也就是让 `SKILL.md` 的最终位置类似：

```text
C:\YourWorkspace\.opencode\skills\create-testcases\SKILL.md
```

- 放到这个位置后，重启或重新进入该工作区，再让 OpenCode 重新发现本地 skills

### 目录说明

- `fixtures/` — 测试夹具目录，包含导出测试的 fixture 数据
- `exports/` — 示例产物目录，包含历史导出的测试用例示例，不参与正常运行流程

### 常见问题

- 只复制脚本文件会缺少模板和运行配置
- 没执行 `npm install` 会导致依赖缺失
- “本地能运行” 和 “OpenCode 能自动识别为 skill” 是两回事；自动识别时要特别检查 `SKILL.md` 是否位于 `<workspace>\.opencode\skills\create-testcases\`
