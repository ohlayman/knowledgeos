# KnowledgeOS 进度台账

> 唯一进度来源。任务完成后立即更新本文件，不把进度写在聊天或零散文档里。
> 状态：`TODO` / `DOING` / `DONE` / `BLOCKED`

---

## 1. 当前结论

- **当前阶段：** V3（MCP Server）完成：六个工具、令牌与作用域、检索阶段下推、审计与限流、32KB 截断、stdio/HTTP 传输均已实现；10 条验收 + 1 条连通性检查全部通过。
- **当前版本：** V3。
- **下一步：** 接入真实模型复测图谱类型准确率与 Agent 质量；在 Claude Code / Cursor 中完成真实会话验证 MCP 采用率；V1 发布仍待确认。
- **环境说明：** 本机原生 PostgreSQL 占用 5432，compose 的 Postgres 映射到宿主 5433；`.env.example` 已同步。
- **集成测试：** Turbo 2 默认 strict 环境透传，跑真实依赖需 `RUN_DB_INTEGRATION=1 pnpm test -- --env-mode=loose`。
- **阻塞：** 无。

---

## 2. 四段式流程进度

| 版本 | PRD | 技术设计 | 数据库设计 | 实现计划 | 编码 |
| --- | --- | --- | --- | --- | --- |
| V1 | DONE | DONE | DONE | DONE | DONE（M0–M8，发布待确认） |
| V1.5 | DONE | DONE（扩展章节） | DONE（预留表） | DONE（里程碑） | DONE（12/12 验收） |
| V2 | DONE | DONE（扩展章节） | DONE（预留表） | DONE（里程碑） | DONE（12/12 验收） |
| V3 | DONE | DONE（扩展章节） | DONE（预留表） | DONE（里程碑） | DONE（11/11 验收） |

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
| M1-T3 仓储层 | DONE | 2026-11-01 | 2026-11-01 | documents / chunks / jobs / conversations 四类仓储；集成测试 5/5 通过 |
| M1-T4 种子数据 | DONE | 2026-11-01 | 2026-11-01 | `pnpm --filter @kos/database seed` 两次执行后 1 用户 / 13 设置 |
| M1-T5 Qdrant 客户端封装 | DONE | 2026-11-01 | 2026-11-01 | `@kos/retrieval` 集成测试通过：建集合、索引、upsert、过滤检索、按版本删除 |
| M1-T6 A-2 十万块压测 | DONE | 2026-11-01 | 2026-11-01 | 10 万点/1536 维/3 条件/Top-20：P50 88.2ms、P95 92.6ms、P99 99.6ms |
| M1-T7 压测结论与 ADR | DONE | 2026-11-01 | 2026-11-01 | 通过 300ms 门禁，ADR-002 记录保留 Qdrant |

### M2 导入与解析

| 任务 | 状态 | 开始 | 完成 | 证据 |
| --- | --- | --- | --- | --- |
| M2-T1 StorageAdapter | DONE | 2026-11-01 | 2026-11-01 | `@kos/storage` 6/6 单测通过：原子写、读取流、存在/删除、路径穿越拒绝 |
| M2-T2 哈希与规范化 | DONE | 2026-11-01 | 2026-11-01 | `normalizeText` / `contentHash` / `fileHash`；7/7 测试通过 |
| M2-T3 文件上传 API | DONE | 2026-11-01 | 2026-11-01 | magic bytes、20MB/200 文件限制、fileHash 去重、同名文件追加版本；真实上传冒烟通过 |
| M2-T4 手动文本 API | DONE | 2026-11-01 | 2026-11-01 | Zod 校验、200k 字符上限、contentHash 去重、同名标题追加版本、不同标题同内容追加来源 |
| M2-T5 URL 导入 + SSRF | DONE | 2026-11-01 | 2026-11-01 | 协议/凭证校验、DNS 全地址校验、逐跳重定向、10MB 限制、公网导入与私网拒绝冒烟通过 |
| M2-T6 Markdown 解析 | DONE | 2026-11-01 | 2026-11-01 | `@kos/parser`：标题/段落/列表/代码/表格 + UTF-16 偏移；结构快照 + 偏移回切 + emoji 用例 |
| M2-T7 纯文本解析 | DONE | 2026-11-01 | 2026-11-01 | 按空行切段落、CRLF 兼容、偏移回切用例 |
| M2-T8 PDF 解析 | DONE | 2026-11-01 | 2026-11-01 | 20 页 fixture：页码/矩形/逐页重复页眉剔除/扫描件 `needs_ocr`/加密映射 |
| M2-T9 HTML 正文提取 | DONE | 2026-11-01 | 2026-11-01 | readability + linkedom：3 个 fixture，导航/广告/评论剔除，短正文回退 |
| M2-T10 去重与版本判定 | DONE | 2026-11-01 | 2026-11-01 | 内容哈希（规范化正文）统一判定：同来源重复跳过、异来源追加来源、同来源变更升版本；解析结果写入版本 |
| M2-T11 文档 API | DONE | 2026-11-01 | 2026-11-01 | 列表（status/type/tag/q/游标）、详情（含版本与来源）、PATCH、逻辑删除；19 条路由测试 + 真实库测试 |
| M2-T12 批量导入集成测试 | DONE | 2026-11-01 | 2026-11-01 | 真实导入 200 文件：190 queued、10 个损坏单独失败并可重试；耗时约 4.8s |

### M3 处理流水线

| 任务 | 状态 | 开始 | 完成 | 证据 |
| --- | --- | --- | --- | --- |
| M3-T1 BullMQ 队列 | DONE|2026-11-01|2026-11-01|`@kos/queue`：连接解析、幂等入队、真实 Redis 入队与消费测试 |
| M3-T2 流水线编排与恢复 | DONE|2026-11-01|2026-11-01|七步流水线、`job_steps` 持久化、跳过成功步骤；断点恢复测试 |
| M3-T3 清洗步骤 | DONE|2026-11-01|2026-11-01|`normalizeText` 清洗、空正文判定、字符数计数 |
| M3-T4 元数据步骤 | DONE|2026-11-01|2026-11-01|标题/语言/作者/字数写入版本元数据，缺失用文档标题兜底 |
| M3-T5 切块器 | DONE|2026-11-01|2026-11-01|`@kos/chunking`：标题分组、句子边界、代码/表格独立、10% 重叠、小块合并；8 条 golden 测试 |
| M3-T6 Embedding Adapter | DONE|2026-11-01|2026-11-01|OpenAI 兼容（批量/超时/重试）+ Fake；6 条测试覆盖批量、重试、4xx、维度校验 |
| M3-T7 Qdrant 写入 | DONE|2026-11-01|2026-11-01|点 ID=chunkId、payload 含文档/版本/标签、批量 upsert；重跑不产生重复点 |
| M3-T8 索引与 ready 判定 | DONE|2026-11-01|2026-11-01|全部块 `vectorStatus=ready` 才置版本 ready；否则整步失败 |
| M3-T9 对账任务 | DONE|2026-11-01|2026-11-01|补投 Redis 缺失的 queued 任务、删除孤儿向量；3 条真实 Qdrant 测试 |
| M3-T10 任务 API 与重试 | DONE|2026-11-01|2026-11-01|列表/详情/单步与整单重试/取消；6 条路由测试 + 4 条真实库测试 |
| M3-T11 并发控制 | DONE|2026-11-01|2026-11-01|worker 并发读 `processing.concurrency`（默认 2）；问答并发留待 M5 |

### M4 检索

| 任务 | 状态 | 开始 | 完成 | 证据 |
| --- | --- | --- | --- | --- |
| M4-T1 bigram 与查询构造 | DONE | 2026-11-01 | 2026-11-01 | `buildSearchText` 与 `buildTsQuery`（AND + 分组 OR），7 条单测 |
| M4-T2 关键词检索 | DONE | 2026-11-01 | 2026-11-01 | tsvector + ts_rank_cd，范围/标签/历史版本过滤下推，真实库测试 |
| M4-T3 向量检索 | DONE | 2026-11-01 | 2026-11-01 | Qdrant Top-40、阈值 0.2、payload 过滤，回表取块内容 |
| M4-T4 查询理解 | DONE | 2026-11-01 | 2026-11-01 | 规则实现：对比/操作/事实/开放分类与实体抽取；LLM 改写接口预留，M5 接入 |
| M4-T5 对比型拆分 | DONE | 2026-11-01 | 2026-11-01 | 对比问题按实体分别召回后合并融合 |
| M4-T6 RRF 融合 | DONE | 2026-11-01 | 2026-11-01 | `rrf` k=60，同分按最高单路排名与 ID 稳定排序 |
| M4-T7 重排 | DONE | 2026-11-01 | 2026-11-01 | 重排接口与 5s 超时降级；无 provider 时标记 `rerank_skipped`，M5 接入 LLM 重排 |
| M4-T8 证据装配 | DONE | 2026-11-01 | 2026-11-01 | 去重保序、块边界预算截断（6000 token）、来源路径/页码/标题路径 |
| M4-T9 检索调试 API | DONE | 2026-11-01 | 2026-11-01 | `POST /retrieval/search` 返回证据与轨迹，落 `retrieval_runs` |
| M4-T10 评测集与脚本 | DONE | 2026-11-01 | 2026-11-01 | 10 篇语料 + 50 条问题 JSONL；`pnpm eval:retrieval` |
| M4-T11 A-1 关键词验证 | DONE | 2026-11-01 | 2026-11-01 | Recall@10 0.96、MRR@10 0.94，均高于门槛 |
| M4-T12 降级矩阵 | DONE | 2026-11-01 | 2026-11-01 | 向量库不可用→关键词兜底；关键词 SQL 失败→向量兜底；两者皆失败抛错 |

### M5 问答与引用

| 任务 | 状态 | 开始 | 完成 | 证据 |
| --- | --- | --- | --- | --- |
| M5-T1 会话与消息 API | DONE | 2026-11-01 | 2026-11-01 | 会话列表/新建/详情/删除、消息详情；6 条路由测试 |
| M5-T2 SSE 协议 | DONE | 2026-11-01 | 2026-11-01 | meta/status/retrieval/delta/citations/done/error 事件，客户端断开标记 stopped |
| M5-T3 Prompt 构建 | DONE | 2026-11-01 | 2026-11-01 | 系统约束 + 证据编号 + 历史裁剪（3000 token）；5 条测试 |
| M5-T4 流式生成 | DONE | 2026-11-01 | 2026-11-01 | OpenAI 兼容流式适配器（SSE 解析、首 token 前重试、用量回报）+ Fake |
| M5-T5 引用解析与后校验 | DONE | 2026-11-01 | 2026-11-01 | 角标解析、范围/块存在/当前版本校验，partial/failed 状态与 invalid 明细 |
| M5-T6 无证据路径 | DONE | 2026-11-01 | 2026-11-01 | 固定文案、不调用模型、done.status=no_evidence |
| M5-T7 多轮上下文 | DONE | 2026-11-01 | 2026-11-01 | 最近 10 条消息 + token 预算裁剪；后续问题测试覆盖 |
| M5-T8 反馈 API | DONE | 2026-11-01 | 2026-11-01 | helpful/not_helpful/citation_wrong（必填角标）+ 快照 |
| M5-T9 消息历史 | DONE | 2026-11-01 | 2026-11-01 | 消息含引用按序返回；会话标题由首轮问题生成 |

### M6 前端

| 任务 | 状态 | 开始 | 完成 | 证据 |
| --- | --- | --- | --- | --- |
| M6-T1 令牌与组件基座 | DONE | 2026-11-01 | 2026-11-01 | 语义令牌 + 深浅主题；对比度沿用原型；未引入 Tailwind/shadcn（见台账裁定） |
| M6-T2 应用壳与路由 | DONE | 2026-11-01 | 2026-11-01 | 导航、路由、Query 客户端、Toast、⌘K 命令面板、404 |
| M6-T3 Dashboard | DONE | 2026-11-01 | 2026-11-01 | 六指标卡（可跳转筛选）、最近文档/任务、空/加载/错误态、30s 轮询且页面隐藏暂停 |
| M6-T4 Library | DONE | 2026-11-01 | 2026-11-01 | 搜索/状态/来源/标签筛选、分页、导入抽屉（文本/文件/URL）与逐项结果 |
| M6-T5 Document Detail | DONE | 2026-11-01 | 2026-11-01 | 块边界阅读器、块索引、版本列表、编辑/删除、引用深链高亮 |
| M6-T6 Research | DONE | 2026-11-01 | 2026-11-01 | 会话列表、SSE 流式、停止、引用角标与证据面板、打开原文段落 |
| M6-T7 Jobs | DONE | 2026-11-01 | 2026-11-01 | 任务列表、步骤时间线、单步/整单重试、取消 |
| M6-T8 Settings | DONE | 2026-11-01 | 2026-11-01 | 模型配置（密钥加密保存、掩码显示）、连接测试、检索偏好、存储、主题 |
| M6-T9 四态/响应式/键盘/主题 | DONE | 2026-11-01 | 2026-11-01 | 空/加载/错误/部分失败；1100/860/640 三档断点；⌘K 与表单键盘可达；深浅主题 |
| M6-T10 E2E | DONE | 2026-11-01 | 2026-11-01 | Playwright 2 条用例：导入→就绪→阅读→提问→引用跳转→任务→主题，移动端导航 |

### M7 运维与发布

| 任务 | 状态 | 开始 | 完成 | 证据 |
| --- | --- | --- | --- | --- |
| M7-T1 数据导出 | DONE | 2026-11-01 | 2026-11-01 | `GET /export` zip（manifest/文档/版本/块/会话/设置，密钥仅后四位）；集成测试解压校验 |
| M7-T2 清空知识库 | DONE | 2026-11-01 | 2026-11-01 | 需输入 DELETE（路由与 service 双重校验）；删向量集合、数据库、对象；设置页危险区 |
| M7-T3 备份脚本 | DONE | 2026-11-01 | 2026-11-01 | `pnpm backup` 生成 dump + objects zip + manifest（SHA-256）；本机无 pg_dump 时走 Docker |
| M7-T4 恢复演练 | DONE | 2026-11-01 | 2026-11-01 | `pnpm restore` 恢复临时库，documents/chunks/versions 与源库一致（4/4/4） |
| M7-T5 保留策略 | DONE | 2026-11-01 | 2026-11-01 | 逻辑删除 30 天物理清理、轨迹/审计 90 天、事件 180 天、幂等键过期清理；worker 每日执行 |
| M7-T6 可观测性 | DONE | 2026-11-01 | 2026-11-01 | 指标新增队列积压、最近系统事件、检索 P95、引用失败率；Dashboard 系统健康卡片 |
| M7-T7 镜像与生产 compose | DONE | 2026-11-01 | 2026-11-01 | api/worker/web 镜像构建成功；生产 compose 启动 api 后 `/health/ready` 返回 200（独立 project 与卷，演练后清理） |
| M7-T8 运维文档 | DONE | 2026-11-01 | 2026-11-01 | `docs/OPERATIONS.md`：启动、备份恢复、升级、保留、清空、排障与命令表 |

### M8 验收与发布

| 任务 | 状态 | 开始 | 完成 | 证据 |
| --- | --- | --- | --- | --- |
| M8-T1 PRD 22.1 验收 | DONE | 2026-11-01 | 2026-11-01 | `docs/ACCEPTANCE_V1.md`：22/22 通过；`pnpm accept:v1` 12/12 |
| M8-T2 性能测试 | DONE | 2026-11-01 | 2026-11-01 | `pnpm bench:v1`：接口 P95 16ms、检索 62ms、首 token 560ms、处理中 13ms；见 `docs/PERFORMANCE_REPORT.md` |
| M8-T3 安全测试 | DONE | 2026-11-01 | 2026-11-01 | `docs/SECURITY_REPORT.md`：SSRF、伪装文件、密钥、注入均通过 |
| M8-T4 缺陷修复 | DONE | 2026-11-01 | 2026-11-01 | 重导入 500、注入逃逸、抽屉键盘、批量异常中断、降级标注均已修复并回归 |
| M8-T5 发布 | TODO | — | — | 用户决定暂缓（2026-11-01）；未打 tag、未创建 Release |

### V1.5 任务看板

| 任务 | 状态 | 完成 | 证据 |
| --- | --- | --- | --- |
| V15-M1 抽取 Schema / 结构化输出 / 缓存 / 失败跳过 | DONE | 2026-11-01 | `@kos/extraction` 10 条单测；抽取缓存按块/模型/版本 |
| V15-M2 实体对齐、关系/事实入库、来源块校验 | DONE | 2026-11-01 | `ExtractionRepository` 4 条集成测试；无来源块不入库 |
| V15-M3 归属判定三级规则与判定记录 | DONE | 2026-11-01 | `judgeOwnership` 7 条测试：精确/结构/语义/合并建议 |
| V15-M4 Wiki 编译、模板、段落-证据绑定、引用验证 | DONE | 2026-11-01 | `compilePage` 7 条测试；12 段上限 |
| V15-M5 冲突检测（数值/否定/时间） | DONE | 2026-11-01 | `detectConflicts` 5 条测试，10 组冲突全部标记 |
| V15-M6 提案生成、10 分钟合并、幂等 | DONE | 2026-11-01 | Worker `runWikiCompile`；`dedupeKey` + 合并窗口 |
| V15-M7 审核工作台 API | DONE | 2026-11-01 | `WikiService` + 路由：接受/拒绝/改写、baseRevisionId 校验 |
| V15-M8 版本、回滚、过期提醒、双链 | DONE | 2026-11-01 | 仓储 8 条集成测试；stale 待办；反链自动维护 |
| V15-M9 Wiki 前端 | DONE | 2026-11-01 | 页面树/阅读/编辑/历史/审核/冲突；导航待办徽标；E2E 2 条 |
| V15-M10 12 条验收 + 提案质量报告 | DONE | 2026-11-01 | `accept:v15` 12/12；`docs/WIKI_QUALITY_REPORT.md` |

### V2 任务看板

| 任务 | 状态 | 完成 | 证据 |
| --- | --- | --- | --- |
| V2-M1 关系入图门槛、待定区、去噪 | DONE | 2026-11-01 | 低置信度/单次 RELATED_TO 入待定区；确认后转 human；`extraction.integration.test.ts` |
| V2-M2 邻域（≤3 跳）、路径查询、边证据 | DONE | 2026-11-01 | `@kos/graph` + `PrismaGraphStore`；2 条集成测试 |
| V2-M3 路径评分、第三路检索、RRF 融合 | DONE | 2026-11-01 | `scorePath` 5 条测试；检索集成测试出现 `trace.paths` |
| V2-M4 图谱 UI：两跳聚焦、按需展开、400 聚合、列表退路 | DONE | 2026-11-01 | `/graph`；E2E 展开去重、移动端列表；`lib/graph.test.ts` |
| V2-M5 Agent 运行时：工具、白名单、步数/预算、失败恢复 | DONE | 2026-11-01 | `@kos/agent-core` 9 条运行时测试；6 个工具 |
| V2-M6 执行记录：调用链、脱敏、不可编辑 | DONE | 2026-11-01 | RunStep/ToolCall 持久化；`redactParams` 测试；回放 UI |
| V2-M7 Agent UI：配置、试运行、执行记录 | DONE | 2026-11-01 | `/agents`、`/agents/:id`、`/agents/runs/:runId`；E2E |
| V2-M8 12 条验收 + 图谱质量报告 | DONE | 2026-11-01 | `accept:v2` 12/12；`docs/GRAPH_QUALITY_REPORT.md` |

### V3 任务看板

| 任务 | 状态 | 完成 | 证据 |
| --- | --- | --- | --- |
| V3-M1 stdio MCP 服务、五个只读工具 | DONE | 2026-11-01 | `apps/mcp-server`；MCP SDK stdio 客户端验收；工具清单与 `readOnlyHint` 单测 |
| V3-M2 令牌创建/吊销/作用域；哈希存储 | DONE | 2026-11-01 | `McpTokenRepository` + `/mcp-tokens`；明文仅创建时返回；仓储集成测试 |
| V3-M3 检索阶段作用域下推 | DONE | 2026-11-01 | `resolveTokenScope` + 检索 `documentIds/tags` 过滤；审计 `pushedFilters` |
| V3-M4 审计与限流；不记录正文 | DONE | 2026-11-01 | `mcp_audit_logs`；令牌级 QPS + 日上限；路由单测 |
| V3-M5 `propose_knowledge_update`（默认关闭） | DONE | 2026-11-01 | 只创建待审提案，幂等 dedupeKey；默认白名单不含该工具 |
| V3-M6 32KB 截断与可疑内容标记 | DONE | 2026-11-01 | `fitToLimit` 单测 + 验收 500 条压到 32522 字节；注入样本 `suspicious` |
| V3-M7 HTTP 传输 + TLS + Origin 校验 | DONE | 2026-11-01 | `StreamableHTTPServerTransport`、可选 HTTPS、Origin 白名单；未用真实证书实测 |
| V3-M8 Claude Code / Cursor 接入片段 | DONE | 2026-11-01 | 设置页三个 Tab 片段（占位符）；真实客户端会话待用户复测 |
| V3-M9 10 条验收 + 外部可用性报告 | DONE | 2026-11-01 | `accept:v3` 11/11；`docs/MCP_USABILITY_REPORT.md` |

---

## 4. 质量门禁

| 门禁 | 状态 | 当前值 | 门槛 |
| --- | --- | --- | --- |
| 检索 Recall@10 | DONE | 1.00 | ≥ 0.85 |
| 检索 MRR | DONE | 1.00 | ≥ 0.6 |
| Qdrant P95（10 万块/3 条件） | DONE | 92.6ms | ≤ 300ms（>600ms 切 pgvector） |
| 首 token P95 | DONE | 560ms（Fake 模型） | ≤ 2.5s |
| 非 LLM 接口 P95 | DONE | 16ms | ≤ 300ms |
| 处理中普通接口 P95 | DONE | 13ms | ≤ 500ms |
| 引用可解析率 | DONE | 100%（20/20） | 100% |
| 正文对比度 | DONE | 最低 5.00:1 | ≥ 4.5:1 |
| 单测 | DONE | 283/283 通过（api 74 + shared 50 + parser 25 + wiki-engine 25 + web 18 + graph 12 + agent-core 12 + llm 12 + extraction 10 + embeddings 10 + chunking 8 + mcp-server 8 + storage 8 + retrieval 9 + queue 2） | 全绿 |
| 集成 | DONE | 72/72 通过（数据库 23 + api 25 + worker 11 + 检索 11 + 队列 1 + 评测 1） | 全绿 |
| E2E | DONE | 14/14 通过（V1 四档/三态/键盘、Wiki、图谱展开与实体高亮、Agent 回放、MCP 接入向导与日志、移动端） | 全绿 |
| V1.5 验收 | DONE | 12/12 通过（`pnpm accept:v15`） | 全绿 |
| V1.5 提案质量 | DONE | 见 `docs/WIKI_QUALITY_REPORT.md`（样本 183 条：接受率 83.3%、平均审核 0.7 分钟） | 已产出 |
| V2 验收 | DONE | 12/12 通过（`pnpm accept:v2`） | 全绿 |
| V2 图谱质量 | DONE | 见 `docs/GRAPH_QUALITY_REPORT.md`（样本 199 条，证据可解析率 100%，人工确认 3%） | 已产出 |
| V3 验收 | DONE | 11/11 通过（`pnpm accept:v3`：10 条 AC + 1 条工具连通性） | 全绿 |
| V3 外部可用性 | DONE | 见 `docs/MCP_USABILITY_REPORT.md`（13 次调用成功率 100%，平均 75ms；真实客户端采用率待测） | 已产出 |

---

## 5. 变更记录

| 日期 | 变更 |
| --- | --- |
| 2026-10-31 | 完成技术设计、数据库设计、实现计划；建立本台账；V1 编码待启动 |
| 2026-10-31 | M0-T1/T3/T4/T6 完成；M0-T2/T5 卡在 Docker Desktop 守护进程无法启动；单测 10/10 通过 |
| 2026-11-01 | M0 完成：真实 readiness 200；修复 x-request-id、根 .env 加载；Postgres 宿主端口改 5433；CI 首次运行通过 |
| 2026-11-01 | M1-T1/T2/T4 完成：Prisma Schema、两份迁移、种子数据；生成列与触发器已做真实写入/回滚验证 |
| 2026-11-01 | M1-T5/T6/T7 完成：Qdrant 客户端与集成测试通过；A-2 压测 P95 92.6ms，保留 Qdrant |
| 2026-11-01 | M1-T3 完成：四类仓储与 5 条集成测试；补 `documents.tags` 字段与 GIN 索引迁移 |
| 2026-11-01 | M2-T1/T2 完成：本地 StorageAdapter 与哈希/规范化工具；单测 24/24 |
| 2026-11-01 | M2-T3 完成：文件上传 API（magic bytes、大小/数量限制、去重与版本追加）；单测 28/28、集成 7/7 |
| 2026-11-01 | M2-T4 完成：手动文本导入、Zod 校验、contentHash 去重与来源追加；单测 31/31、集成 8/8 |
| 2026-11-01 | 构建稳定性：turbo 让 typecheck/test 依赖同包 build，避免 Windows 下并发 `prisma generate` 的 DLL 锁冲突 |
| 2026-11-01 | M2-T5 完成：URL 导入、SSRF（私网/回环/链路本地/逐跳重定向）、10MB 限制；单测 43/43、集成 9/9 |
| 2026-11-01 | M2-T6~T9 完成：新增 `@kos/parser`，Markdown/纯文本/PDF/HTML 四类解析器与 MIME 分派；单测 67/67 |
| 2026-11-01 | M2-T10~T12 完成：内容哈希去重与版本判定、文档列表/详情/标签/逻辑删除、200 文件批量导入；单测 76/76、集成 12/12；M2 收尾 |
| 2026-11-01 | M3 完成：队列与 worker、七步流水线、切块、Embedding、Qdrant 写入、对账、任务 API；20 页 PDF 端到端 ready |
| 2026-11-01 | M4 完成：双路召回、RRF、证据装配、降级与检索 API；50 条评测 Recall@10 0.96 / MRR 0.94 |
| 2026-11-01 | M5 完成：会话与 SSE 流式、Prompt、引用后校验、无证据与历史、反馈；引用校验与停止生成均有测试 |
| 2026-11-01 | M6 完成：五个页面、四态、主题与响应式、⌘K、E2E；补齐 metrics/settings/chunks API 与密钥加密 |
| 2026-11-01 | M7 完成：导出/清空、备份与恢复演练、保留策略、健康指标、生产镜像与 compose、运维手册 |
| 2026-11-01 | M8-T1~T4 完成：PRD 22.1 22/22 验收、性能与安全报告；修复重导入 500、提示注入逃逸、抽屉键盘焦点、批量异常中断；单测 180、集成 53、E2E 7 |
| 2026-11-01 | M8-T5 待确认：版本号、CHANGELOG、tag 与 GitHub Release |
| 2026-11-01 | V1.5 完成：抽取、编译、归属、冲突、提案、审核 API、版本/回滚/过期、双链与 Wiki 前端；`accept:v15` 12/12；提案质量报告产出 |
| 2026-11-01 | V2 完成：入图门槛、图查询与第三路检索、图谱 UI、Agent 运行时/工具/预算、执行回放；`accept:v2` 12/12；图谱质量报告产出 |
| 2026-11-01 | V3 完成：六个 MCP 工具、令牌/作用域、检索下推、审计与限流、32KB 截断、stdio/HTTP；`accept:v3` 11/11；外部可用性报告产出 |
