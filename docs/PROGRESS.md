# KnowledgeOS 进度台账

> 唯一进度来源。任务完成后立即更新本文件，不把进度写在聊天或零散文档里。
> 状态：`TODO` / `DOING` / `DONE` / `BLOCKED`

---

## 1. 当前结论

- **当前阶段：** M1 数据层进行中：Schema、迁移、种子、Qdrant 客户端与 A-2 压测已完成；仓储层待做。
- **当前版本：** V1。
- **下一步：** 实现仓储层（documents / versions / chunks / jobs），完成 M1-T3。
- **环境说明：** 本机原生 PostgreSQL 占用 5432，compose 的 Postgres 映射到宿主 5433；`.env.example` 已同步。
- **阻塞：** 无。

---

## 2. 四段式流程进度

| 版本 | PRD | 技术设计 | 数据库设计 | 实现计划 | 编码 |
| --- | --- | --- | --- | --- | --- |
| V1 | DONE | DONE | DONE | DONE | TODO |
| V1.5 | DONE | DONE（扩展章节） | DONE（预留表） | DONE（里程碑） | BLOCKED（等 V1 验收） |
| V2 | DONE | DONE（扩展章节） | DONE（预留表） | DONE（里程碑） | BLOCKED（等 V1.5） |
| V3 | DONE | DONE（扩展章节） | DONE（预留表） | DONE（里程碑） | BLOCKED（等 V1 检索质量） |

**说明：** 技术设计、数据库设计、实现计划采用「一套主文档 + 版本扩展」的组织方式，不按版本拆成 12 份，避免重复内容与维护分叉。

### 2.1 设计文档产出

| 文档 | 路径 | 状态 | 完成日期 |
| --- | --- | --- | --- |
| 技术设计 | `docs/TECHNICAL_DESIGN.md` | DONE | 2026-10-31 |
| 数据库设计 | `docs/DATABASE_DESIGN.md` | DONE | 2026-10-31 |
| 实现计划 | `docs/IMPLEMENTATION_PLAN.md` | DONE | 2026-10-31 |

---

## 3. V1 任务看板

### M0 工程骨架

| 任务 | 状态 | 开始 | 完成 | 证据 |
| --- | --- | --- | --- | --- |
| M0-T1 pnpm workspace / Turborepo / TS / Lint | DONE | 2026-10-31 | 2026-10-31 | `pnpm typecheck/lint/test/build/format:check` 全通过 |
| M0-T2 docker-compose（PG/Redis/Qdrant） | DONE | 2026-10-31 | 2026-11-01 | 三容器 healthy；Postgres 宿主端口 5433（5432 被本机原生 PG 占用） |
| M0-T3 shared 基础（错误码/Zod/常量） | DONE | 2026-10-31 | 2026-10-31 | `packages/shared` 6/6 测试通过 |
| M0-T4 Fastify 骨架 + 错误信封 | DONE | 2026-10-31 | 2026-11-01 | API 5/5 测试通过；含 `x-request-id`、CORS、Helmet 断言 |
| M0-T5 健康检查 | DONE | 2026-10-31 | 2026-11-01 | 真实 `/health/ready` 返回 200，database/redis/qdrant 均 ok |
| M0-T6 CI | DONE | 2026-10-31 | 2026-11-01 | 首次 GitHub Actions 运行成功（run 41215947135） |

### M1 数据层与技术验证

| 任务 | 状态 | 开始 | 完成 | 证据 |
| --- | --- | --- | --- | --- |
| M1-T1 Prisma Schema + 初始迁移 | DONE | 2026-11-01 | 2026-11-01 | `20261031164344_init` 已应用；36 张表（含 `_prisma_migrations`） |
| M1-T2 原始 SQL 迁移（搜索/部分唯一/触发器） | DONE | 2026-11-01 | 2026-11-01 | `20261031164359_search_and_constraints` 已应用；8 个索引、生成列、触发器、2 个 CHECK 均验证 |
| M1-T3 仓储层 | TODO | — | — | — |
| M1-T4 种子数据 | DONE | 2026-11-01 | 2026-11-01 | `pnpm --filter @kos/database seed` 两次执行后 1 用户 / 13 设置 |
| M1-T5 Qdrant 客户端封装 | DONE | 2026-11-01 | 2026-11-01 | `@kos/retrieval` 集成测试通过：建集合、索引、upsert、过滤检索、按版本删除 |
| M1-T6 A-2 十万块压测 | DONE | 2026-11-01 | 2026-11-01 | 10 万点/1536 维/3 条件/Top-20：P50 88.2ms、P95 92.6ms、P99 99.6ms |
| M1-T7 压测结论与 ADR | DONE | 2026-11-01 | 2026-11-01 | 通过 300ms 门禁，ADR-002 记录保留 Qdrant |

### M2 导入与解析

| 任务 | 状态 | 开始 | 完成 | 证据 |
| --- | --- | --- | --- | --- |
| M2-T1 StorageAdapter | TODO | — | — | — |
| M2-T2 哈希与规范化 | TODO | — | — | — |
| M2-T3 文件上传 API | TODO | — | — | — |
| M2-T4 手动文本 API | TODO | — | — | — |
| M2-T5 URL 导入 + SSRF | TODO | — | — | — |
| M2-T6 Markdown 解析 | TODO | — | — | — |
| M2-T7 纯文本解析 | TODO | — | — | — |
| M2-T8 PDF 解析 | TODO | — | — | — |
| M2-T9 HTML 正文提取 | TODO | — | — | — |
| M2-T10 去重与版本判定 | TODO | — | — | — |
| M2-T11 文档 API | TODO | — | — | — |
| M2-T12 批量导入集成测试 | TODO | — | — | — |

### M3 处理流水线

| 任务 | 状态 | 开始 | 完成 | 证据 |
| --- | --- | --- | --- | --- |
| M3-T1 BullMQ 队列 | TODO | — | — | — |
| M3-T2 流水线编排与恢复 | TODO | — | — | — |
| M3-T3 清洗步骤 | TODO | — | — | — |
| M3-T4 元数据步骤 | TODO | — | — | — |
| M3-T5 切块器 | TODO | — | — | — |
| M3-T6 Embedding Adapter | TODO | — | — | — |
| M3-T7 Qdrant 写入 | TODO | — | — | — |
| M3-T8 索引与 ready 判定 | TODO | — | — | — |
| M3-T9 对账任务 | TODO | — | — | — |
| M3-T10 任务 API 与重试 | TODO | — | — | — |
| M3-T11 并发控制 | TODO | — | — | — |

### M4 检索

| 任务 | 状态 | 开始 | 完成 | 证据 |
| --- | --- | --- | --- | --- |
| M4-T1 bigram 与查询构造 | TODO | — | — | — |
| M4-T2 关键词检索 | TODO | — | — | — |
| M4-T3 向量检索 | TODO | — | — | — |
| M4-T4 查询理解 | TODO | — | — | — |
| M4-T5 对比型拆分 | TODO | — | — | — |
| M4-T6 RRF 融合 | TODO | — | — | — |
| M4-T7 重排 | TODO | — | — | — |
| M4-T8 证据装配 | TODO | — | — | — |
| M4-T9 检索调试 API | TODO | — | — | — |
| M4-T10 评测集与脚本 | TODO | — | — | — |
| M4-T11 A-1 关键词验证 | TODO | — | — | — |
| M4-T12 降级矩阵 | TODO | — | — | — |

### M5 问答与引用

| 任务 | 状态 | 开始 | 完成 | 证据 |
| --- | --- | --- | --- | --- |
| M5-T1 会话与消息 API | TODO | — | — | — |
| M5-T2 SSE 协议 | TODO | — | — | — |
| M5-T3 Prompt 构建 | TODO | — | — | — |
| M5-T4 流式生成 | TODO | — | — | — |
| M5-T5 引用解析与后校验 | TODO | — | — | — |
| M5-T6 无证据路径 | TODO | — | — | — |
| M5-T7 多轮上下文 | TODO | — | — | — |
| M5-T8 反馈 API | TODO | — | — | — |
| M5-T9 消息历史 | TODO | — | — | — |

### M6 前端

| 任务 | 状态 | 开始 | 完成 | 证据 |
| --- | --- | --- | --- | --- |
| M6-T1 令牌与组件基座 | TODO | — | — | — |
| M6-T2 应用壳与路由 | TODO | — | — | — |
| M6-T3 Dashboard | TODO | — | — | — |
| M6-T4 Library | TODO | — | — | — |
| M6-T5 Document Detail | TODO | — | — | — |
| M6-T6 Research | TODO | — | — | — |
| M6-T7 Jobs | TODO | — | — | — |
| M6-T8 Settings | TODO | — | — | — |
| M6-T9 四态/响应式/键盘/主题 | TODO | — | — | — |
| M6-T10 E2E | TODO | — | — | — |

### M7 运维与发布

| 任务 | 状态 | 开始 | 完成 | 证据 |
| --- | --- | --- | --- | --- |
| M7-T1 数据导出 | TODO | — | — | — |
| M7-T2 清空知识库 | TODO | — | — | — |
| M7-T3 备份脚本 | TODO | — | — | — |
| M7-T4 恢复演练 | TODO | — | — | — |
| M7-T5 保留策略 | TODO | — | — | — |
| M7-T6 可观测性 | TODO | — | — | — |
| M7-T7 镜像与生产 compose | TODO | — | — | — |
| M7-T8 运维文档 | TODO | — | — | — |

### M8 验收与发布

| 任务 | 状态 | 开始 | 完成 | 证据 |
| --- | --- | --- | --- | --- |
| M8-T1 PRD 22.1 验收 | TODO | — | — | — |
| M8-T2 性能测试 | TODO | — | — | — |
| M8-T3 安全测试 | TODO | — | — | — |
| M8-T4 缺陷修复 | TODO | — | — | — |
| M8-T5 发布 | TODO | — | — | — |

---

## 4. 质量门禁

| 门禁 | 状态 | 当前值 | 门槛 |
| --- | --- | --- | --- |
| 检索 Recall@10 | TODO | — | ≥ 0.85 |
| 检索 MRR | TODO | — | ≥ 0.6 |
| Qdrant P95（10 万块/3 条件） | DONE | 92.6ms | ≤ 300ms（>600ms 切 pgvector） |
| 首 token P95 | TODO | — | ≤ 2.5s |
| 非 LLM 接口 P95 | TODO | — | ≤ 300ms |
| 引用可解析率 | TODO | — | 100% |
| 单测 | DONE | 11/11 通过（shared 6 + api 5） | 全绿 |
| 集成/E2E | TODO | — | 全绿 |

---

## 5. 变更记录

| 日期 | 变更 |
| --- | --- |
| 2026-10-31 | 完成技术设计、数据库设计、实现计划；建立本台账；V1 编码待启动 |
| 2026-10-31 | M0-T1/T3/T4/T6 完成；M0-T2/T5 卡在 Docker Desktop 守护进程无法启动；单测 10/10 通过 |
| 2026-11-01 | M0 完成：真实 readiness 200；修复 x-request-id、根 .env 加载；Postgres 宿主端口改 5433；CI 首次运行通过 |
| 2026-11-01 | M1-T1/T2/T4 完成：Prisma Schema、两份迁移、种子数据；生成列与触发器已做真实写入/回滚验证 |
| 2026-11-01 | M1-T5/T6/T7 完成：Qdrant 客户端与集成测试通过；A-2 压测 P95 92.6ms，保留 Qdrant |
