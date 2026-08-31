---
trigger: always_on
description: 在生成测试用例时自动通过 ima-skill 检索 IMA 知识库已有文档作为设计基线，并严格清理中间临时产物
---

# 测试用例生成联动 IMA 知识库与清理规则

当用户要求使用 `create-testcases` 生成测试用例，或询问测试用例设计时：

1. **主动知识库检索**：
   - 自动调用 `ima-skill` 搜索知识库（`search_knowledge_base` / `search_knowledge`）及个人笔记（`search_note`），寻找与目标功能相关的已有文档、接口定义或 PRD。
2. **提取已有文档内容**：
   - 知识库条目：通过 `get_media_info` 获取原文内容（笔记类型媒体通过 `get_doc_content` 读取）。
   - 个人笔记：通过 `get_doc_content` 读取正文。
3. **基于已有文档设计用例**：
   - 将检索到的已有文档作为基础上下文，与用户给出的增量需求结合，生成兼具完整性与针对性的 QA 测试用例。
   - 在需求分析摘要中明确标注：“输入来源：IMA 知识库 - <条目名称>”。
4. **严格清理中间产物**：
   - 解析在线原型（如 Mockplus）产生的抓取缓存（如 `exports/mockplus`）属于调试提取中间物。
   - 分析提取及用例导出完成后，必须在当前轮次结束前立即自动删除，确保 `exports/` 仅保留最终的 `.md`、`.xlsx`、`.xmind` 产物。
