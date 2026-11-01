# KnowledgeOS

本地优先的个人知识引擎。把散落在文件、网页和笔记里的材料收进一个可检索、可追溯、可维护的知识库：

**导入材料 → 解析切块 → 混合检索 → 带可验证引用的问答 → Wiki 沉淀 → 图谱浏览 → Agent 使用 → MCP 对外提供。**

所有数据默认留在本机：PostgreSQL、Redis、Qdrant 与原始文件都在本地，不依赖云端知识库服务。

## 功能总览

| 模块         | 能力                                                                                                              |
| ------------ | ----------------------------------------------------------------------------------------------------------------- |
| 知识库       | 文件 / 手动文本 / 网页链接导入；Markdown、纯文本、文本型 PDF、HTML 解析；去重与版本追加；标签和状态筛选；批量导入 |
| 文档阅读     | 原文阅读、切块查看、命中片段定位、实体高亮、来源与版本信息                                                        |
| 混合检索     | 向量召回 + 关键词召回 + 图谱路径三路融合（RRF），支持标签/文档范围过滤                                            |
| 问答         | SSE 流式回答、引用后校验、引用点击跳原文、无证据明确提示、会话历史与反馈                                          |
| Wiki         | 从抽取结果编译页面、段落归属、冲突检测、提案审核、版本历史、回滚、过期复核、双链与反链                            |
| 知识图谱     | 3D / 平面 / 列表三态；邻域展开、路径查询、搜索定位、面包屑、悬停高亮、待定关系确认、实体合并                      |
| Agent Studio | Agent 配置、6 个工具、工具白名单、步数 / token / 工具次数预算、执行记录与回放、参数脱敏                           |
| MCP Server   | 6 个 MCP 工具、令牌与作用域、QPS / 日额度、审计、32KB 截断、可疑内容标记、stdio / HTTP                            |
| 任务与运维   | 处理队列、重试与取消、指标面板、备份恢复、导出、按保留策略清理、生产 compose                                      |
| 设置         | 问答 / Embedding 模型、检索参数、MCP 接入、主题、存储与危险操作                                                   |

## 架构

```mermaid
flowchart LR
    WEB["React 前端<br/>Vite :5173"] --> API["Fastify API<br/>:3000"]
    MCP["MCP Server<br/>stdio / HTTP"] --> API
    API --> PG[("PostgreSQL 16<br/>:5433")]
    API --> REDIS[("Redis 7<br/>:6379")]
    API --> QDRANT[("Qdrant 1.20<br/>:6333")]
    API --> FILES[("本地原始文件<br/>data/")]
    REDIS --> WORKER["BullMQ Worker"]
    WORKER --> PG
    WORKER --> QDRANT
    WORKER --> FILES
```

- 前端：React 19 + Vite + TanStack Query。
- 后端：Fastify 5，单体 API；Worker 独立进程消费 BullMQ。
- 存储：PostgreSQL 是事实源；Qdrant 存向量；Redis 队列与缓存；原始文件按 SHA-256 不可变存储。
- 图与 Agent：`@kos/graph`、`@kos/agent-core`；MCP 只做协议适配，不重新实现检索与权限。

## 快速开始

### 1. 环境要求

- Node.js 22+
- pnpm 8.6.6（`corepack prepare pnpm@8.6.6 --activate`）
- Docker Desktop（PostgreSQL 16、Redis 7、Qdrant 1.20）

> 如果本机 PATH 中存在同名 `docker` 的 npm 包，请使用 Docker Desktop 自带的 CLI，例如：
> `/c/Users/<you>/AppData/Local/Programs/DockerDesktop/resources/bin/docker.exe`。
>
> 如果本机已有 PostgreSQL 占用 5432，compose 会把容器映射到宿主 5433；`.env.example` 已按 5433 配置。

### 2. 配置与启动

```bash
cp .env.example .env
pnpm install
```

```bash
docker compose up -d
```

```bash
pnpm --filter @kos/database migrate:deploy
pnpm --filter @kos/database seed
```

分别启动三个进程（推荐三个终端）：

```bash
pnpm --filter @kos/api dev
```

```bash
pnpm --filter @kos/worker dev
```

```bash
pnpm --filter @kos/web dev
```

也可以用一个命令启动全部开发 watcher：

```bash
pnpm dev
```

打开 http://localhost:5173 。健康检查：

```bash
curl http://127.0.0.1:3000/api/v1/health/live
curl http://127.0.0.1:3000/api/v1/health/ready
```

> **默认是 Fake 模型。** `.env.example` 中 `EMBEDDING_PROVIDER=fake`、`LLM_PROVIDER=fake` 时，回答是占位文本、向量不具备真实语义能力，仅用于开发与验收。接入真实模型请填写 API Key，或启动后在「设置 → 模型与连接」中保存（密钥加密存库）。

## 使用说明

### 导入材料

进入 **知识库** → 右上角「导入材料」，三种方式：

- **手动文本**：标题、正文、标签。
- **文件**：Markdown / 纯文本 / 文本型 PDF，单个不超过 20MB，单批最多 200 个。
- **网页链接**：抓取正文，SSRF 防护只允许公网 HTTP(S)。

导入后到 **任务** 页面看处理进度。扫描版 PDF 会标记 `needs_ocr`，当前不支持 OCR。

### 阅读与检查

在知识库列表打开任意文档：

- 左侧/正文查看原文，右侧查看切块与处理状态；
- 从问答或图谱跳转时，会自动定位到块并高亮实体；
- 可修改标题与标签，删除为逻辑删除（原始文件保留）。

### 提问

进入 **问答**：

1. 新建会话并输入问题，回答以 SSE 流式返回；
2. 每个引用都能点击跳回原文块；
3. 没有足够证据时会明确提示，不编造；
4. 关系型问题会额外出现「关系路径」面板，展示图上的路径与每条边的证据；
5. 会话历史与回答反馈都会保存。

检索参数可在 **设置 → 检索偏好** 调整（TopK、RRF k 值、是否包含历史版本等）。

### Wiki

进入 **Wiki**：

- 导入材料抽取后会生成页面与提案；
- **审核队列**逐个接受、拒绝或改写提案；
- **冲突裁决**处理数值 / 否定 / 时间等冲突；
- 页面支持版本历史、回滚、双链、反链与过期复核；
- 提案不会自动改页面，只有接受后才写入。

### 知识图谱

进入 **图谱**：

- 桌面默认 **3D**，可切「平面 / 列表」；窄屏默认列表；
- 点击节点展开一跳，右侧抽屉看详情、关系与来源；
- 搜索实体可定位并高亮；平面视图支持滚轮缩放、空白拖拽平移与「重置视图」；
- 待定关系在页面底部单独列出，点击「确认入图」才会进入主图；
- 3D 不可用时自动回落平面并提示。

### Agent Studio

进入 **Agent**：

- 新建 Agent，配置系统提示词、模型、工具白名单与预算；
- 运行后可逐步回放：每一步的思考摘要、工具调用、参数（已脱敏）与结果；
- 工具只读或只创建提案，没有写入工具；
- 单日额度用尽会拒绝新执行。

### 任务

「任务」页面查看处理中、失败与已完成的任务；失败任务可重试，运行中的任务可取消。

### 设置

- **模型与连接**：问答 / Embedding Provider、Base URL、API Key、连接测试；
- **检索偏好**：召回数量、切块参数、问答并发等；
- **MCP 接入**：令牌、作用域、工具白名单、调用日志；
- **外观**：浅色 / 深色 / 跟随系统；
- **存储**：导出、备份、清空知识库、查看存储指标。

## MCP 接入

MCP 让 Claude Code、Cursor 等客户端直接读取知识库。

1. 启动 API，打开 **设置 → MCP 接入**，创建令牌；明文只显示一次。
2. 构建 MCP Server：

```bash
pnpm --filter @kos/mcp-server build
```

3. 新建配置（非 Windows 系统要求 `chmod 600`）：

```json
{
  "apiUrl": "http://127.0.0.1:3000",
  "token": "kos_xxxxxxxx"
}
```

4. 在客户端配置 `mcpServers`：

```json
{
  "mcpServers": {
    "knowledgeos": {
      "command": "node",
      "args": [
        "<KnowledgeOS 目录>/apps/mcp-server/dist/index.js",
        "--config",
        "<你的目录>/kos-mcp.json"
      ]
    }
  }
}
```

也可用 HTTP 模式：

```bash
node apps/mcp-server/dist/index.js --http --port 3344 --config ./kos-mcp.json
```

可用工具：`search_knowledge`、`read_wiki`、`get_related_knowledge`、`get_knowledge_sources`、`ask_knowledge`、`propose_knowledge_update`（默认关闭）。令牌可限制文档范围、工具白名单、QPS、日额度与有效期；所有调用写入审计，不记录返回正文。

完整接入、排障与安全说明见 [`docs/OPERATIONS.md`](docs/OPERATIONS.md) 2.2 节。

## 配置

| 变量                                | 默认                                              | 说明                       |
| ----------------------------------- | ------------------------------------------------- | -------------------------- |
| `HOST` / `PORT`                     | `127.0.0.1` / `3000`                              | API 监听地址               |
| `WEB_ORIGIN`                        | `http://localhost:5173`                           | CORS 允许来源              |
| `DATABASE_URL`                      | `postgresql://kos:kos@localhost:5433/knowledgeos` | PostgreSQL                 |
| `REDIS_URL`                         | `redis://localhost:6379`                          | Redis / BullMQ             |
| `QDRANT_URL`                        | `http://localhost:6333`                           | Qdrant                     |
| `DATA_DIR`                          | `./data`                                          | 原始文件与索引数据目录     |
| `EMBEDDING_PROVIDER`                | `fake`                                            | `fake` / `openai` 等       |
| `EMBEDDING_MODEL` / `EMBEDDING_DIM` | `text-embedding-3-small` / `1536`                 | 向量模型与维度             |
| `LLM_PROVIDER`                      | `fake`                                            | `fake` / OpenAI 兼容       |
| `LLM_MODEL`                         | —                                                 | 问答模型                   |
| `APP_ENCRYPTION_KEY`                | 空                                                | 数据库内 Provider 密钥加密 |
| `LOG_LEVEL`                         | `info`                                            | 日志级别                   |

模型密钥也可以只在设置页保存，不必写进 `.env`。

## 工程命令

```bash
pnpm dev          # 全部开发 watcher
pnpm typecheck
pnpm lint
pnpm test
pnpm build
pnpm format       # 格式化
pnpm format:check
```

验收与质量报告（需要 API / worker / Docker 依赖运行）：

```bash
pnpm accept:v1
pnpm accept:v15
pnpm accept:v2
pnpm accept:v3
pnpm perf:graph3d
pnpm report:wiki
pnpm report:graph
pnpm check:contrast
```

集成测试：

```bash
set -a && source .env && set +a && RUN_DB_INTEGRATION=1 pnpm test -- --env-mode=loose
```

E2E：

```bash
pnpm --filter @kos/web exec playwright test
```

清理验收/测试残留：

```bash
pnpm clean:test-data
```

## 目录结构

```text
apps/
  api/          Fastify HTTP 服务
  web/          React 前端
  worker/       BullMQ 处理进程
  mcp-server/   MCP stdio / HTTP 服务
packages/
  shared/       共享契约、错误码、环境变量
  database/     Prisma Schema、迁移与仓储
  retrieval/    向量 / 关键词 / 图谱三路检索
  graph/        图谱查询、评分与路径
  agent-core/   Agent 运行时与工具
  wiki-engine/  Wiki 编译、归属、冲突与链接
  extraction/   实体与关系抽取
  llm/          模型 Provider 适配
  embeddings/   Embedding Provider 适配
  parser/       Markdown / 文本 / PDF / HTML 解析
  chunking/     切块
  queue/        BullMQ 队列
  storage/      本地文件存储
  evaluation/   检索评测
docs/           产品、设计、验收与运维文档
design/         交互原型
scripts/        验收、报告、备份与清理脚本
```

## 文档

- [docs/README.md](docs/README.md)：文档索引
- [docs/OPERATIONS.md](docs/OPERATIONS.md)：启动、备份恢复、升级、保留策略、MCP 排障
- [docs/PROGRESS.md](docs/PROGRESS.md)：唯一进度台账与质量门禁
- [docs/ACCEPTANCE_V1.md](docs/ACCEPTANCE_V1.md)、[V1.5](docs/ACCEPTANCE_V1.5.md)、[V2](docs/ACCEPTANCE_V2.md)、[V2.1](docs/ACCEPTANCE_V2.1.md)、[V2.2](docs/ACCEPTANCE_V2.2.md)、[V3](docs/ACCEPTANCE_V3.md)：逐版本验收
- [docs/GRAPH_3D_PERFORMANCE_REPORT.md](docs/GRAPH_3D_PERFORMANCE_REPORT.md)：3D 首帧、帧率与体积
- [docs/WIKI_QUALITY_REPORT.md](docs/WIKI_QUALITY_REPORT.md)、[docs/GRAPH_QUALITY_REPORT.md](docs/GRAPH_QUALITY_REPORT.md)：Wiki / 图谱质量
- [design/prototype.html](design/prototype.html)：可交互原型

## 当前状态

V1、V1.5、V2、V2.1（3D 图谱）、V2.2（平面交互）与 V3（MCP）均已完成并通过各自验收：

| 版本 | 验收                         |
| ---- | ---------------------------- |
| V1   | 22/22 PRD，`accept:v1` 12/12 |
| V1.5 | 12/12                        |
| V2   | 12/12                        |
| V2.1 | 10/10                        |
| V2.2 | 8/8                          |
| V3   | 11/11                        |

质量门禁：单测 321、E2E 25 全绿（详见 `docs/PROGRESS.md`）。

**V1 发布仍待确认**：版本号、CHANGELOG、git tag 与 GitHub Release 尚未创建。

## 已知限制

- **默认 Fake 模型**：回答与向量只用于开发；真实检索质量、图谱关系类型、Agent 质量需要在配置真实模型后复测。
- **单用户本地部署**：没有登录与多租户权限；不要把 API 直接暴露到公网。
- **扫描 PDF 不支持 OCR**：会标记 `needs_ocr`。
- **MCP 真实客户端采用率待测**：协议层已验证；Claude Code / Cursor 的真实会话需要按上面的片段配置后复测。
- **3D 400 节点为合成数据**：真实知识库的帧率与可读性仍需复测。
- **Agent 执行在 API 进程内**：服务重启不会自动恢复 `running` 记录。
- **平面视图标签不避让**：节点密集时标签可能重叠；节点上拖拽不触发平移，画布平移需从空白处开始。
