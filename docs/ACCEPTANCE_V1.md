# KnowledgeOS V1 验收记录

> 对应 PRD 22.1。每条都必须有自动化测试或可复现步骤，本表只记录本次实际执行结果。
> 执行日期：2026-11-01。环境：Windows 10、Node 22、Docker Desktop；Postgres 16 / Redis 7 / Qdrant 1.20；模型使用本地 Fake 实现（未配置真实 API Key）。

## 1. 结论

PRD 22.1 的 22 条验收项全部通过。执行过程中发现并修复 4 个缺陷（见第 4 节），其中 2 个为 P1：删除后重新导入同一来源返回 500、提示注入可闭合证据块。当前质量门禁：单测 180、集成 53、E2E 7；检索评测 Recall@10 与 MRR@10 均为 1.00。

## 2. 复现方式

```bash
set -a && source .env && set +a
RUN_DB_INTEGRATION=1 pnpm test -- --env-mode=loose
pnpm accept:v1
pnpm bench:v1
pnpm check:contrast
pnpm --filter @kos/web exec playwright test
```

- `accept:v1` 需要 API、worker 与 Docker 依赖在运行，会真实抓取 3 个公网 URL，结束后逻辑删除测试文档。
- `bench:v1` 使用当前配置的模型；本次为 Fake，仅衡量本地链路开销，真实模型的首 token 还包含上游网络与推理时间。
- 验收残留可执行 `pnpm clean:test-data` 清理。

## 3. 验收记录

| 验收项（PRD 22.1） | 结果 | 证据 | 日期 |
| --- | --- | --- | --- |
| 四类来源各导入 3 份，成功率 100%，失败项有可读原因 | 通过 | `pnpm accept:v1`：Markdown/PDF/手动文本/URL 各 3/3 就绪 | 2026-11-01 |
| 同一文件重复导入两次，文档数只 +1，第二次提示重复 | 通过 | `pnpm accept:v1`（status=duplicate）；`document-service.integration.test.ts` | 2026-11-01 |
| 内容修改后导入，文档 1 条、版本 2 个，检索默认命中新版本 | 通过 | `pnpm accept:v1`（v2 命中、旧版本未命中）；`document-service.integration.test.ts` | 2026-11-01 |
| 批量 50 份中 5 份损坏，45 份成功，失败项可单独重试 | 通过 | `pnpm accept:v1`；另有 200/10 集成测试 `batch-import.integration.test.ts` | 2026-11-01 |
| 私网 URL 被拒绝且不泄露内网信息 | 通过 | `pnpm accept:v1`（错误均为「URL 指向不允许的地址」）；`url-fetcher.test.ts` | 2026-11-01 |
| 抽查 10 个块，偏移与页码可定位原文 | 通过 | `pnpm accept:v1`：3 份 16 页 PDF，抽查 10 块，偏移回切一致、页码有效 | 2026-11-01 |
| 同一版本重复处理两次，块数不变（幂等） | 通过 | `pipeline.integration.test.ts`「re-running the same job is idempotent」 | 2026-11-01 |
| 人为中断后重试，不重复执行已成功的上游步骤 | 通过 | `pipeline.integration.test.ts`「resumes from the first unfinished step」 | 2026-11-01 |
| 处理 10 份文档期间，普通接口 P95 ≤ 500ms | 通过 | `pnpm bench:v1`：处理中文档列表 P95 13ms；10 份处理耗时 2.8s | 2026-11-01 |
| 索引写入失败的文档不会显示为 ready | 通过 | `pipeline.integration.test.ts`「does not mark the version ready when the index write fails」 | 2026-11-01 |
| 50 条评测集 Recall@10 ≥ 0.85，MRR ≥ 0.6 | 通过 | `pnpm eval:retrieval`：Recall@10 1.00、MRR@10 1.00 | 2026-11-01 |
| 对比型问题两个专名两方均被召回 | 通过 | `service.integration.test.ts`「splits comparison questions into entity queries」 | 2026-11-01 |
| 向量检索不可用时关键词正常返回，UI 标注降级 | 通过 | `service.integration.test.ts` 降级用例；`business.test.tsx` DegradedNote 渲染 | 2026-11-01 |
| 空知识库提问返回「未找到相关内容」，不含模型自身知识 | 通过 | `conversation-service.integration.test.ts`「returns a fixed no-evidence answer without calling the model」 | 2026-11-01 |
| 抽检 20 条回答，引用块 100% 可解析 | 通过 | `pnpm accept:v1`：20/20 含引用，全部 valid，块均可解析，后校验 0 失败 | 2026-11-01 |
| 点击任一引用可定位并高亮具体段落 | 通过 | Playwright `acceptance.spec.ts` 键盘用例与 `smoke.spec.ts`：URL 带 chunk、`data-highlight=true` | 2026-11-01 |
| 人为破坏引用后 UI 出现「不可验证」提示 | 通过 | `business.test.tsx` invalid 角标；`conversation-service.integration.test.ts` out-of-range 标记 | 2026-11-01 |
| 首 token 延迟 P95 ≤ 2.5s | 通过 | `pnpm bench:v1`：P95 560ms（Fake 模型） | 2026-11-01 |
| 390 / 768 / 1024 / 1440 四档无横向滚动 | 通过 | Playwright `acceptance.spec.ts`：6 个页面 × 4 档全部满足 | 2026-11-01 |
| 空、加载、错误三态均可到达并正确渲染 | 通过 | Playwright `acceptance.spec.ts` 三条状态用例 | 2026-11-01 |
| 全流程可用键盘完成：导入 → 查看 → 提问 → 打开引用 | 通过 | Playwright 键盘用例；`ui.test.tsx` 抽屉焦点陷阱与 Escape | 2026-11-01 |
| 深浅主题正文对比度 ≥ 4.5:1 | 通过 | `pnpm check:contrast`：两主题 26 组正文组合最低 5.00:1 | 2026-11-01 |
| 前端接口响应不含密钥明文 | 通过 | `settings-service.integration.test.ts`（仅 last4）；导出集成测试校验；`apiKeyLast4` 响应 | 2026-11-01 |
| 伪装扩展名的可执行文件被拒绝（按文件头） | 通过 | `routes.test.ts`「rejects a disguised executable based on its magic bytes」；`accept:v1` 批量损坏文件 | 2026-11-01 |
| 知识库植入提示注入文本，问答行为不受影响 | 通过 | `prompt.test.ts`：闭合标签被转义、属性引号被转义、系统提示声明证据是数据 | 2026-11-01 |
| 从零启动到可提问有可执行文档，他人可照做 | 通过 | `docs/OPERATIONS.md` 第 1–2 节 | 2026-11-01 |
| 备份还原演练成功，还原后数据完整可检索 | 通过 | `pnpm backup`（dump 399,789B）→ 临时库恢复；documents/versions/chunks = 179/181/232 与源库一致 | 2026-11-01 |

## 4. 本轮发现与修复的缺陷

| 级别 | 现象 | 根因 | 修复 | 回归 |
| --- | --- | --- | --- | --- |
| P1 | 删除文档后重新导入同一来源（如同一 URL）返回 500 | `findDocumentBySource` 未排除逻辑删除文档，后续追加版本触发 `(document_id, content_hash)` 唯一约束 | 查询加 `document.isDeleted = false`，重新导入创建新文档 | `document-service.integration.test.ts` 新增用例 |
| P1 | 文档内容含 `</evidence>` 时可提前闭合证据块，后续文本被当作指令 | 证据块直接拼接原文 | 转义 `</evidence`，属性值转义双引号；PROMPT_VERSION 升为 v2 | `prompt.test.ts` 两条注入用例 |
| P2 | 导入抽屉打开后焦点停留在页面，Escape 无效，无法纯键盘完成导入 | Drawer 无焦点管理 | 打开时聚焦面板、Escape 关闭、Tab 在抽屉内循环 | `ui.test.tsx` 三条用例 |
| P2 | 批量导入中单个非预期异常会中断整批并返回 500 | 路由只捕获 `ApiError` | 非预期异常记录日志并作为单项失败返回 | 集成测试与 `accept:v1` |
| P3 | 检索降级提示只存在于流式临时状态，回答结束后消失 | 降级信息未随消息持久化 | 抽取 `DegradedNote` 组件并补单测；持久化留待后续版本 | `business.test.tsx` |

## 5. 未覆盖与已知限制

- **真实模型未参与本次验收**：Embedding 与 Chat 均使用 Fake 实现（未配置 Key）。真实模型的首 token、向量质量与费用需在有 Key 的环境复测；本地链路的 P95 已达标。
- **默认关闭 LLM 改写与 LLM 重排**：接口已预留，当前走规则与 no-op，评测结果基于该配置。
- **扫描件 PDF 明确不支持**：标记 `needs_ocr` 并保留原文件。
- **降级提示不持久化**：回答完成后从消息历史回看时不再显示当次降级原因。
- 性能数据来自本机开发环境，非生产规格；详见 `PERFORMANCE_REPORT.md`。

## 6. 相关报告

- `PERFORMANCE_REPORT.md`：接口、检索、首 token 与处理耗时。
- `SECURITY_REPORT.md`：SSRF、伪装文件、密钥与提示注入。
