# KnowledgeOS V1 性能测试报告

> 对应实现计划 M8-T2。日期：2026-11-01。

## 1. 结论

全部性能门槛通过。本机开发环境（Windows 10、Node 22、Docker Desktop）下：

| 指标 | 结果 | 门槛 |
| --- | --- | --- |
| 非 LLM 接口 P95（空闲） | 16ms（指标概览） | ≤ 300ms |
| 检索 P95 | 62ms | ≤ 300ms |
| 首 token P95 | 560ms（Fake 模型） | ≤ 2500ms |
| 10 份文档处理期间普通接口 P95 | 13ms | ≤ 500ms |
| 10 份文档处理耗时 | 2.8s | 无硬门槛 |

## 2. 方法

```bash
pnpm bench:v1
```

脚本 `scripts/bench-v1.mjs` 对运行中的 API 执行：

1. 顺序采样：文档列表、指标概览、任务列表各 50 次；`POST /retrieval/search` 30 次。
2. 首 token：新建会话，连续 10 次提问，记录 SSE 第一个 `delta` 事件到达时间。
3. 处理负载：一次上传 10 份 Markdown，在处理期间每 200ms 采样 `GET /documents`，直到全部 ready。

P95 取排序后第 `ceil(0.95 × n)` 个样本。

## 3. 结果

| 场景 | 样本数 | P50 | P95 |
| --- | --- | --- | --- |
| `GET /documents` | 50 | 6ms | 8ms |
| `GET /metrics/overview` | 50 | 12ms | 16ms |
| `GET /jobs` | 50 | 7ms | 10ms |
| `POST /retrieval/search` | 30 | 57ms | 62ms |
| 首 token（SSE） | 10 | 85ms | 560ms |
| `GET /documents`（10 份处理中） | 8 | 8ms | 13ms |

处理期间队列并发 2，Embedding 为本地 Fake 实现。

## 4. 解释与限制

- **Fake 模型**：首 token 只包含本地检索、Prompt 构建与流式转发开销。接入真实模型后，首 token 主要由上游网络与推理决定，需在目标供应商上复测 2.5s 门槛。
- **数据规模**：开发库约 1 份文档；Qdrant 十万块规模的独立压测见 M1-T6（P95 92.6ms），本报告不复测。
- **单机样本**：样本量小且为本机环境，用于验收门槛判断，不作为容量规划依据。
- 采样与处理并发执行时会互相影响，本次处理负载很低，P95 仍远低于 500ms。
