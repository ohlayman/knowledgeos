# KnowledgeOS V2 验收记录

> 对应 `PRD_V2_Graph_Agent.md` 第 11 章。执行日期：2026-11-01。模型为本地 Fake 实现。

## 1. 结论

V2 的 12 条验收全部通过。图谱入图门槛、邻域/路径查询、第三路检索融合、图谱浏览与实体高亮，以及 Agent 运行时、工具白名单、预算/步数终止、执行回放均已实现。图谱质量报告见 `GRAPH_QUALITY_REPORT.md`。

## 2. 复现方式

```bash
set -a && source .env && set +a
RUN_DB_INTEGRATION=1 pnpm test -- --env-mode=loose
pnpm accept:v2
pnpm report:graph
pnpm --filter @kos/web exec playwright test
```

- `accept:v2` 需要 API 与 worker 运行，会创建测试文档、确认待定关系、创建并归档测试 Agent。
- 测试数据可用 `pnpm clean:test-data` 清理。

## 3. 验收记录

| 验收项 | 结果 | 证据 | 日期 |
| --- | --- | --- | --- |
| AC-V2-1 路径 ≤3 跳，每条边有可解析证据块 | 通过 | `pnpm accept:v2`：两跳路径，逐块 `/chunks/:id` 校验通过 | 2026-11-01 |
| AC-V2-2 节点展开不重复加载；>400 节点聚合 | 通过 | Playwright `graph.spec.ts`：重复点击只产生 1 次邻域请求；`lib/graph.test.ts` 400 阈值；390 宽默认列表视图 | 2026-11-01 |
| AC-V2-3 关系型问题出现关系路径，事实型不出现 | 通过 | `pnpm accept:v2`：关系问题 `trace.paths` 非空，事实问题为 undefined | 2026-11-01 |
| AC-V2-4 单次 RELATED_TO 只进待定区 | 通过 | `pnpm accept:v2`：待定 2 条、主视图无该关系；确认后入图 | 2026-11-01 |
| AC-V2-5 合并后历史关系可查，撤销恢复 | 通过 | `pnpm accept:v2`：合并后路径仍可查、撤销后原路径恢复；`graph.integration.test.ts` | 2026-11-01 |
| AC-V2-6 步数上限终止且无第 13 步 | 通过 | `pnpm accept:v2`：maxSteps=1 的 Agent 以 `step_limit` 结束，仅 1 步；`agent-core/runtime.test.ts` | 2026-11-01 |
| AC-V2-7 工具参数非法返回结构化错误并允许修正 | 通过 | `agent-core/runtime.test.ts`：INVALID_ARGS 后模型修正并成功，不崩溃 | 2026-11-01 |
| AC-V2-8 提示注入不调用未授权工具 | 通过 | `pnpm accept:v2`：注入文档下仅调用白名单内 `search_knowledge`；运行时单测覆盖越权工具拒绝 | 2026-11-01 |
| AC-V2-9 执行记录可回放、参数脱敏、步骤不可编辑 | 通过 | `pnpm accept:v2` 检查步骤与 toolCalls；参数脱敏函数单测；Playwright 回放页展示「参数（已脱敏）」；无编辑接口 | 2026-11-01 |
| AC-V2-10 单日预算耗尽拒绝新执行 | 通过 | `pnpm accept:v2`：预算设为 1 后返回 429「今日 Agent 额度已用完」 | 2026-11-01 |
| AC-V2-11 节点可跳转原文并高亮实体 | 通过 | `pnpm accept:v2` 校验提及偏移；Playwright 图谱用例：来源 → 定位 → `[data-entity-highlight]` | 2026-11-01 |
| AC-V2-12 删除执行记录后成本统计正确 | 通过 | `pnpm accept:v2`：删除后 runs 与 tokens 同步减少；`agent.integration.test.ts` | 2026-11-01 |

## 4. 质量门禁

| 项 | 结果 |
| --- | --- |
| 单测 | 255/255（新增 graph 12、agent-core 12、web graph 2、api 路由 4、retrieval 2） |
| 集成 | 71/71（新增图仓储 2、Agent 仓储 2、检索融合 1、抽取门槛 1） |
| E2E | 12/12（新增图谱 2、Agent 1） |
| 验收脚本 | `accept:v2` 12/12 |
| 图谱质量 | `GRAPH_QUALITY_REPORT.md`（样本 199 条，证据可解析率 100%，人工确认占比 3%） |

## 5. 已知限制

- **Fake 抽取器只产出 RELATED_TO**：入图门槛与待定区逻辑可验证，但九种关系类型的真实分布与类型正确率需要真实模型与人工标注复测。
- **图谱规模**：未做全库渲染；>400 聚合在 UI 逻辑中实现并有阈值测试，但没有真实 400 节点数据集的可视化压测。
- **Agent 执行在 API 进程内异步运行**：服务重启会留下 `running` 记录，未做自动恢复；PRD 要求的 120s 超时、并发 2、单日额度已实现。
- **工具参数 Schema 校验在前端不可见**：仅通过运行记录中的 `INVALID_ARGS` 呈现；没有独立的工具调试页。
- **无写入工具**：`propose_wiki_update` 默认关闭，开启后也只生成提案，不直接落库。
