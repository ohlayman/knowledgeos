# KnowledgeOS 运维手册（V1）

> 覆盖启动、备份、恢复、升级、保留策略与故障排查。按本文从上到下执行，可在新机器从零启动并完成一次问答。

## 1. 前置条件

| 依赖 | 版本 | 说明 |
| --- | --- | --- |
| Node.js | 22.x | API / worker / web 均使用 Node 22 |
| pnpm | 8.6.6 | `corepack prepare pnpm@8.6.6 --activate` |
| Docker | 24+ | 本地开发与生产 compose |
| PostgreSQL | 16 | compose 内置 |
| Redis | 7 | compose 内置 |
| Qdrant | 1.20.0 | compose 内置 |

## 2. 本地启动

```bash
cp .env.example .env
# 按需填写 DATABASE_URL / REDIS_URL / QDRANT_URL / EMBEDDING_* / LLM_*
```

```bash
docker compose up -d
```

```bash
pnpm install && pnpm --filter @kos/database migrate:deploy && pnpm --filter @kos/database seed
```

分别启动三个进程（三个终端）：

```bash
pnpm --filter @kos/api dev
```

```bash
pnpm --filter @kos/worker dev
```

```bash
pnpm --filter @kos/web dev
```

访问 http://localhost:5173 。未配置 `EMBEDDING_API_KEY` / `LLM_API_KEY` 时使用 Fake 实现，仅用于开发：回答内容是占位文本，向量不可用于真实语义检索。

### 2.1 集成测试与 E2E

```bash
set -a && source .env && set +a && RUN_DB_INTEGRATION=1 pnpm test -- --env-mode=loose
```

```bash
pnpm --filter @kos/web exec playwright test
```

E2E 需要 API、worker 与 Docker 依赖已在运行，且会写入一条测试文档（结束时逻辑删除）。

破坏性用例（清空知识库）默认跳过，仅在确认要清空当前库时执行：

```bash
RUN_DB_INTEGRATION=1 RUN_DESTRUCTIVE_TESTS=1 pnpm --filter @kos/api exec vitest run src/modules/maintenance
```

## 2.2 MCP 接入

```bash
pnpm --filter @kos/mcp-server build
```

1. 打开 Web 的「设置 → MCP 接入」，创建令牌；明文只显示一次。
2. 把配置写到本机文件（非 Windows 系统要求 600 权限）：

```json
{
  "apiUrl": "http://127.0.0.1:3000",
  "token": "kos_xxxxxxxx"
}
```

3. stdio 模式（Claude Code / Cursor）：

```bash
node apps/mcp-server/dist/index.js --config ./kos-mcp.json
```

4. HTTP 模式（远程或调试）：

```bash
node apps/mcp-server/dist/index.js --http --port 3344 --config ./kos-mcp.json
```

HTTP 模式优先使用请求头 `Authorization: Bearer kos_...`；配置了 `allowedOrigins` 时只放行列出的 Origin，未配置时只放行 localhost / 127.0.0.1。TLS 通过在配置中提供 `tls.certFile` 与 `tls.keyFile` 启用。

排查：

- `401`：令牌无效、已过期或已吊销；在设置页重新创建。
- `403`：该工具不在令牌白名单中；编辑作用域时勾选。
- `429`：QPS 或日调用上限；展开调用日志查看恢复时间。
- 工具返回为空：检查令牌作用域与文档标签是否匹配；空结果不是错误。

审计不记录返回正文，只记录工具、参数摘要（查询词与作用域）、条数、耗时与状态。定期用 `pnpm clean:test-data` 清理验收令牌。

---

## 3. 生产部署

```bash
cp .env.example .env
# 生产必须配置：APP_ENCRYPTION_KEY（保存 API Key）、EMBEDDING_API_KEY、LLM_API_KEY
```

```bash
docker compose -f docker-compose.prod.yml up -d --build
```

- API 容器启动时自动执行 `migrate:deploy` 与 `seed`（幂等）。
- compose 内覆盖 `DATABASE_URL` / `REDIS_URL` / `QDRANT_URL` 为容器网络地址；`.env` 中的 localhost 值只用于本机开发。
- Web 由 nginx 提供，`/api` 反向代理到 `api:3000`，默认暴露 `8080`。

健康检查：

```bash
curl http://127.0.0.1:3000/api/v1/health/ready
```

```bash
curl http://127.0.0.1:8080/
```

## 4. 备份

```bash
pnpm backup
```

产物位于 `backup/`：

| 文件 | 内容 |
| --- | --- |
| `knowledgeos-<时间>.dump` | `pg_dump -Fc` 全量数据库 |
| `objects-<时间>.zip` | `data/objects` 原始文件 |
| `manifest-<时间>.json` | 文件大小与 SHA-256 |

- 本机没有 `pg_dump` 时自动回退到 `docker compose exec postgres pg_dump`；Windows 下可用 `DOCKER_BIN` 指定 Docker 可执行文件路径。
- 向量不备份：Qdrant 是派生数据，恢复后由对账任务重建。
- 建议每日全量并保留 14 天，定期校验清单中的 SHA-256。

## 5. 恢复

```bash
pnpm restore --file backup/knowledgeos-<时间>.dump --objects backup/objects-<时间>.zip
```

- 数据库使用 `pg_restore --clean --if-exists`，会覆盖同名对象。
- 恢复后启动 API 与 worker；worker 启动时的对账会补投丢失任务、清理孤儿向量，缺失向量随任务重试补齐。
- 恢复演练建议在临时库进行：

```bash
docker exec knowledgeos-postgres-1 createdb -U kos kos_restore_drill
pnpm restore --file backup/<dump> --database-url postgresql://kos:kos@localhost:5433/kos_restore_drill
# 对比 documents / chunks / versions 数量
docker exec knowledgeos-postgres-1 dropdb -U kos kos_restore_drill
```

## 6. 升级

```bash
git pull
pnpm install
pnpm --filter @kos/database migrate:deploy
pnpm build
```

开发模式重启 API / worker / web；生产模式：

```bash
docker compose -f docker-compose.prod.yml up -d --build
```

升级前先 `pnpm backup`。若更换 Embedding 模型，需重建全部向量（见 7.2）。

## 7. 数据保留与清理

### 7.1 自动保留策略

worker 启动时与每 24 小时执行一次：

| 数据 | 保留 | 动作 |
| --- | --- | --- |
| 逻辑删除文档 | 30 天 | 删除 Qdrant 点 → 删除数据库行 → 删除对象 |
| `retrieval_runs` | 90 天 | 按时间删除 |
| `mcp_audit_logs` | 90 天 | 按时间删除 |
| `system_events` | 180 天 | 按时间删除 |
| `idempotency_keys` | 到期即删 | 按 `expires_at` 删除 |

执行结果写入 `system_events`（`type=retention`），Dashboard「系统健康」显示最近事件。

### 7.2 重建向量

更换 Embedding 模型或维度后：

1. 在设置页保存新模型，重启 API 与 worker（集合名随模型/维度变化）。
2. 对受影响文档逐个触发「整单重试」，或等待对账补投。
3. 旧集合可手工删除：`curl -X DELETE $QDRANT_URL/collections/<旧集合名>`。

### 7.3 清空知识库

设置页 → 存储 → 危险区，输入 `DELETE` 确认。接口等价于：

```bash
curl -X POST http://127.0.0.1:3000/api/v1/maintenance/clear -H 'content-type: application/json' -d '{"confirm":"DELETE"}'
```

清理内容：文档、版本、块、来源、会话、消息、引用、检索轨迹、Qdrant 集合与对象文件。操作不可撤销，先执行 `pnpm backup`。

### 7.4 导出

设置页 → 存储 → 数据导出，或：

```bash
curl -OJ http://127.0.0.1:3000/api/v1/export
```

导出包为 zip，包含 `manifest.json`、文档/版本/块/会话/设置 JSON；模型配置只含掩码后的 key 后四位。

## 8. 故障排查

| 现象 | 检查 | 处理 |
| --- | --- | --- |
| `/health/ready` 返回 503 | 响应中的 `checks` 字段 | 启动对应容器；核对 `.env` 地址 |
| 任务一直排队 | Dashboard 队列积压；worker 日志 | 启动/重启 worker；对账会补投缺失任务 |
| 任务失败 `WORKER_INTERRUPTED` | worker 是否被重启 | 任务页「整单重试」 |
| 上传成功但处理失败「缺少原始文件」 | API 与 worker 的 `DATA_DIR` 是否一致 | 统一为仓库根目录下的相对路径或绝对路径 |
| 检索没有结果 | 检索轨迹的 `degraded` | 向量/关键词路径是否被降级；确认文档已 `ready` |
| 引用全部「不可验证」 | 文档是否被重新导入或删除 | 重新提问；历史版本检索需在设置中开启 |
| 保存模型配置报 `APP_ENCRYPTION_KEY` | `.env` 是否配置加密键 | 配置后重启 API |
| 队列告警（积压 > 100） | worker 并发、上游 embedding 状态 | 检查 worker 日志与 provider 连接测试 |

## 9. 常用命令

| 命令 | 作用 |
| --- | --- |
| `pnpm dev` | 同时启动所有 dev 服务 |
| `pnpm test` | 单元测试（跳过真实依赖） |
| `pnpm lint` / `pnpm typecheck` / `pnpm build` | 质量门禁 |
| `pnpm backup` / `pnpm restore --file …` | 备份 / 恢复 |
| `pnpm eval:retrieval` | 50 条检索评测（Recall@10 / MRR@10） |
| `pnpm bench:qdrant` | Qdrant 10 万块压测 |
| `pnpm accept:v1` | PRD 22.1 导入/判重/检索/引用验收（需 API 与 worker 运行） |
| `pnpm accept:v15` | V1.5 Wiki 12 条验收（抽取/提案/冲突/回滚/双链） |
| `pnpm report:wiki` | 生成 `docs/WIKI_QUALITY_REPORT.md`（提案质量） |
| `pnpm accept:v2` | V2 图谱与 Agent 12 条验收 |
| `pnpm report:graph` | 生成 `docs/GRAPH_QUALITY_REPORT.md`（图谱质量） |
| `pnpm bench:v1` | 接口、检索、首 token 与处理耗时压测 |
| `pnpm check:contrast` | 校验深浅主题正文对比度 ≥ 4.5:1 |
| `pnpm --filter @kos/web exec playwright test` | 端到端测试 |
| `pnpm clean:test-data` | 清理中断测试留下的示例文档与测试会话（按标题/来源前缀） |
