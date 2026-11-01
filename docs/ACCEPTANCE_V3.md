# KnowledgeOS V3 验收记录

> 对应 `PRD_V3_MCP.md` 第 10 章。执行日期：2026-11-01。执行方式：官方 MCP TypeScript SDK 的 stdio 客户端拉起本地 `apps/mcp-server`。

## 1. 结论

V3 的 10 条验收全部通过，另加 1 条只读工具连通性检查（EXTRA-1），共 11/11。六个工具、令牌与作用域、检索阶段下推、审计与限流、32KB 截断、可疑内容标记均已实现；stdio 与 Streamable HTTP 两种传输可用。

## 2. 复现方式

```bash
pnpm --filter @kos/mcp-server build
set -a && source .env && set +a
RUN_DB_INTEGRATION=1 pnpm test -- --env-mode=loose
pnpm accept:v3
pnpm --filter @kos/web exec playwright test
```

- `accept:v3` 需要 API 与 worker 运行；会创建测试文档、令牌与 Wiki 页面，结束后自动清理。
- 也可用 `pnpm clean:test-data` 清理残留的 ACV3 / E2E MCP 令牌。

## 3. 验收记录

| 验收项 | 结果 | 证据 | 日期 |
| --- | --- | --- | --- |
| AC-V3-1 stdio 检索返回真实片段与文档/块 ID | 通过 | `accept:v3`：MCP SDK stdio 客户端返回片段，含 `documentId`、`chunkId`、`excerpt` | 2026-11-01 |
| AC-V3-2 限定标签令牌不含作用域外文档，过滤已下推 | 通过 | 作用域外的「机密说明」检索为空；审计 `paramsSummary.pushedFilters.tags` 命中 | 2026-11-01 |
| AC-V3-3 吊销令牌后下一次调用立即失败 | 通过 | MCP 调用返回 `isError`；直连 API 返回 401 | 2026-11-01 |
| AC-V3-4 令牌明文只在创建时出现一次 | 通过 | 创建响应含 `token`；`GET /mcp-tokens` 仅返回前缀 | 2026-11-01 |
| AC-V3-5 提案只创建待审记录，审核前 Wiki 不变 | 通过 | 提案 `pending`；前后页面 `currentRevision.content` 一致；重复调用返回同一提案 ID | 2026-11-01 |
| AC-V3-6 作用域内无结果返回空数组与原因 | 通过 | `items: []`，`reason: no_match_in_scope`，HTTP 200 | 2026-11-01 |
| AC-V3-7 单次返回超过 32KB 被截断并标记 | 通过 | 500 条合成结果压到 32522 字节，`truncated: true`、`originalCount: 500` | 2026-11-01 |
| AC-V3-8 审计含工具、条数、耗时、令牌 ID，不含正文 | 通过 | 审计行含 `tool`、`resultCount`、`durationMs`、`tokenId`；参数摘要不含片段正文 | 2026-11-01 |
| AC-V3-9 日调用上限触发后返回恢复时间 | 通过 | 第二次调用 429，`details.resetsAt` 为次日 00:00（本地时区） | 2026-11-01 |
| AC-V3-10 提示注入被标记且不影响工具行为 | 通过 | 注入文档片段 `suspicious: true`；随后正常检索成功 | 2026-11-01 |
| EXTRA-1 Wiki / 来源 / 问答工具连通 | 通过 | `read_wiki` 返回页面标题；`get_knowledge_sources` 返回文档元数据；`ask_knowledge` 返回答案 | 2026-11-01 |

## 4. 质量门禁

| 项 | 结果 |
| --- | --- |
| 单测 | 283/283（新增 shared 10、api 10、mcp-server 8） |
| 集成 | 72/72（新增 MCP 令牌/审计仓储 1） |
| E2E | 14/14（新增 MCP 接入向导与调用日志 2） |
| 验收脚本 | `accept:v3` 11/11 |
| 外部可用性 | `MCP_USABILITY_REPORT.md`（13 次调用，成功率 100%，平均 75ms） |

## 5. 客户端配置

先创建令牌，把 `kos_xxxxxxxx` 替换为明文；配置文件在非 Windows 系统上必须 `chmod 600`。

```json
{
  "apiUrl": "http://127.0.0.1:3000",
  "token": "kos_xxxxxxxx"
}
```

Claude Code / Cursor 的 `mcpServers` 片段：

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

HTTP 模式：

```bash
node apps/mcp-server/dist/index.js --http --port 3344 --config ./kos-mcp.json
```

## 6. 已知限制

- **真实客户端会话未纳入自动验收**：当前用官方 MCP SDK 的 stdio 客户端验证协议与工具行为；Claude Code / Cursor 的真实会话需要用户粘贴配置后复测，报告中的采用率分析基于脚本化场景。
- **QPS 限流在 API 进程内存中**：单实例有效，重启即清零；多实例部署需要换成 Redis 计数。
- **HTTP 的 TLS 只实现未实测**：配置了证书路径即可启用 HTTPS，但未用真实证书做过端到端验证。
- **`propose_knowledge_update` 的提案内容**：把摘要作为「MCP 提案」段落加入 patch，审核接受后才写入页面；不生成更细的改写。
- **没有 MCP 侧缓存**：这是有意为之，避免缓存绕过吊销与作用域变更。
- **`get_related_knowledge` 依赖图谱质量**：Fake 抽取器只产 RELATED_TO，真实关系类型需接入真实模型后复测。
