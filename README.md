# KnowledgeOS

本地优先的个人知识引擎。导入材料 → 解析切块 → 混合检索 → 带可验证引用的问答；V1.5 加 LLM Wiki，V2 加知识图谱与 Agent Studio，V3 加 MCP Server。

## 环境要求

- Node.js 22+
- pnpm 8+
- Docker Desktop（PostgreSQL 16、Redis 7、Qdrant）

> 如果本机 PATH 中存在同名 `docker` 的 npm 包，请使用 Docker Desktop 自带的 CLI，例如：
> `/c/Users/<you>/AppData/Local/Programs/DockerDesktop/resources/bin/docker.exe`。
>
> 如果本机已有 PostgreSQL 占用 5432，compose 会把容器映射到宿主 5433；`.env.example` 已按 5433 配置。

## 快速开始

```bash
cp .env.example .env
pnpm install
pnpm dev
```

另开一个终端启动依赖：

```bash
docker compose up -d
```

健康检查：

```bash
curl http://127.0.0.1:3000/api/v1/health/live
curl http://127.0.0.1:3000/api/v1/health/ready
```

## 工程命令

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm build
pnpm accept:v1
pnpm accept:v15
pnpm accept:v2
pnpm accept:v3
```

## 目录

```text
apps/api          Fastify HTTP 服务
apps/web          React 前端
apps/worker       BullMQ 处理进程
apps/mcp-server   MCP stdio / HTTP 服务（V3）
packages/shared   共享契约、错误码、环境变量校验
docs              产品、设计与实现计划
design            交互原型
```

## 当前进度

V1、V1.5、V2、V3 与 V2.1（3D 图谱）均已实现并通过各自验收；V1 发布（tag / GitHub Release）仍待确认。完整任务与验收见 [`docs/PROGRESS.md`](docs/PROGRESS.md)。

MCP 接入方式见 [`docs/OPERATIONS.md`](docs/OPERATIONS.md) 的「2.2 MCP 接入」。
