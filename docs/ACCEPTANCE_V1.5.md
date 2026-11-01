# KnowledgeOS V1.5 验收记录

> 对应 `PRD_V1.5_Wiki.md` 第 13 章。执行日期：2026-11-01。模型为本地 Fake 实现（确定性抽取与编译），未配置真实 API Key。

## 1. 结论

V1.5 的 12 条验收全部通过。抽取、编译、归属判定、冲突检测、提案审核、版本回滚、过期提醒与双向链接均已实现，并通过 `pnpm accept:v15` 在真实 API、worker、PostgreSQL 与 Redis 上跑通。提案质量报告见 `WIKI_QUALITY_REPORT.md`。

## 2. 复现方式

```bash
set -a && source .env && set +a
RUN_DB_INTEGRATION=1 pnpm test -- --env-mode=loose
pnpm accept:v15
pnpm report:wiki
pnpm --filter @kos/web exec playwright test
```

- `accept:v15` 需要 API 与 worker 运行，会创建测试文档与页面，结束后逻辑删除文档；页面可由 `pnpm clean:test-data` 清理。
- 验收脚本会直接调用 `@kos/wiki-engine` 的编译函数验证 12 段上限与人工段落保护。

## 3. 验收记录

| 验收项 | 结果 | 证据 | 日期 |
| --- | --- | --- | --- |
| AC-V15-1 新材料生成更新提案，含段落级 diff 与可解析证据 | 通过 | `pnpm accept:v15`：更新提案 baseRevisionId 正确，含 add 段落，证据块可解析 | 2026-11-01 |
| AC-V15-2 矛盾材料出现冲突标记，页面显示未裁决冲突 | 通过 | `pnpm accept:v15`：negation 冲突进入 `/wiki/conflicts`，页面 `unresolvedConflicts > 0` | 2026-11-01 |
| AC-V15-3 引用块删除后提案被拦截并标记 invalid | 通过 | 编译 `evidence_not_in_scope`；落库前校验缺失证据 → `invalid` + `evidence_missing`（`wiki.integration.test.ts`） | 2026-11-01 |
| AC-V15-4 回滚到三版之前，内容正确、历史完整 | 通过 | `pnpm accept:v15`：回滚生成 system 版本，`revisions >= 3`；`wiki.integration.test.ts` | 2026-11-01 |
| AC-V15-5 人工段落不被模型覆盖 | 通过 | 编译返回 `protected` 操作且人工段落保留；`compile.test.ts` 与 `accept:v15` | 2026-11-01 |
| AC-V15-6 页面已更新时接受被拒绝并提示重新计算 | 通过 | `pnpm accept:v15`：人工写入新版本后接受旧提案返回 409；`wiki.integration.test.ts` | 2026-11-01 |
| AC-V15-7 拒绝必须选择结构化原因 | 通过 | `pnpm accept:v15`：缺少原因 400、带原因 200；`wiki/routes.test.ts` | 2026-11-01 |
| AC-V15-8 来源更新后页面标记 stale 并生成复核待办 | 通过 | `pnpm accept:v15`：重新导入同标题文档后页面 stale + `stale_review` 待办；`wiki.integration.test.ts` | 2026-11-01 |
| AC-V15-9 20 个页面每段至少一个可解析证据锚点 | 通过 | `pnpm accept:v15`：20/20 页面，锚点块均可通过 `/chunks/:id` 解析 | 2026-11-01 |
| AC-V15-10 反链在对方新增引用后自动出现 | 通过 | `pnpm accept:v15`：保存含 `[[目标页]]` 的段落，目标页反链立即出现；`links.test.ts` | 2026-11-01 |
| AC-V15-11 同一文档版本重复触发不产生重复提案 | 通过 | `pnpm accept:v15`：连续两次触发抽取/编译，提案数与去重键稳定；`wiki.integration.test.ts` | 2026-11-01 |
| AC-V15-12 单页超过 12 段提示拆分 | 通过 | `compilePage` 返回 `needs_split`；`compile.test.ts` 与 `accept:v15` | 2026-11-01 |

## 4. 质量门禁

| 项 | 结果 |
| --- | --- |
| 单测 | 223/223（新增 extraction 10、wiki-engine 25、shared 4、api 路由 4） |
| 集成 | 65/65（新增抽取入库 4、Wiki 仓储 8） |
| E2E | 9/9（新增 Wiki 2 条：创建/阅读/编辑/历史、审核与冲突页可达） |
| 验收脚本 | `accept:v15` 12/12 |
| 提案质量 | `WIKI_QUALITY_REPORT.md` |

## 5. 已知限制

- **真实模型未参与**：抽取与编译使用 Fake 实现；真实模型的 Schema 通过率、定位准确率与审核接受率需要在有 Key 的环境复测。
- **批量接受未实现界面**：接口支持逐条接受/拒绝/改写，PRD 的批量接受低风险提案尚未提供 UI，也未做「不得批量接受删除/修改」的服务端限制（因为入口不存在）。
- **过期复核的「按新来源更新」**：当前支持确认仍有效与归档；按新来源生成提案可通过重新导入来源间接触发，但没有一键入口。
- **摘要确认**：模型摘要随提案接受一并生效，未单独提供摘要确认按钮；人工创建页面的摘要视为已确认。
- **合并只建议**：`merge_suggestion` 进入审核队列，系统不自动合并；合并执行需要人工使用实体合并接口或手工编辑。
- **无认证/权限**：与 V1 一致，单用户本地部署。
