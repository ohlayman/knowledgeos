# KnowledgeOS

本地优先的个人知识引擎。V1 目标：导入材料 → 解析切块 → 混合检索 → 带可验证引用的问答。

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
```

## 目录

```text
apps/api          Fastify HTTP 服务
packages/shared   共享契约、错误码、环境变量校验
docs              产品、设计与实现计划
design            交互原型
```

## 当前进度

M0 工程骨架。完整任务与验收见 [`docs/PROGRESS.md`](docs/PROGRESS.md)。
