# V2.1 3D 图谱性能与体积报告

> 生成日期：2026-11-01。环境：Windows 10、Chromium（Playwright Headless）、本机开发模式（Vite 5 + Fastify），视口 1440×900。

## 1. 方法

- 脚本：`scripts/graph-3d-perf.mjs`，命令 `pnpm perf:graph3d`。
- 真实样本：当前开发库的入口 20 个高频节点。
- 400 节点样本：Playwright `page.route('**/api/v1/graph/entry')` 返回合成节点，不写入数据库。
- 首帧：从 `page.goto` 到 `.graph-3d canvas` 可见。
- 冻结：等待页面根节点出现 `data-engine="stopped"`（组件在布局收敛后 2.5s 标记）。
- 帧率：冻结后在页面内用 `requestAnimationFrame` 采样 4 秒取平均。
- 降级：覆盖 `HTMLCanvasElement.prototype.getContext` 返回 `null`，测量到 2D 画布可见的时间。

## 2. 结果

| 场景 | 首帧 | 冻结标记 | 平均帧率 |
| --- | --- | --- | --- |
| 入口 20 节点（真实库） | 865ms | 3.41s | 56fps |
| 400 节点（合成） | 914ms | 3.42s | 55fps |
| WebGL 不可用降级 | — | — | 261ms 切到 2D |

## 3. 体积

| 产物 | gzip |
| --- | --- |
| 主包 `index-*.js` | 130.6KB |
| 3D 路由 chunk `Graph3DView-*.js` | 387.5KB |
| 3D chunk 门槛 | ≤450KB |

3D chunk 只在进入 `/graph` 时加载；其他路由的 bundle 不包含 Three.js。

## 4. 解读

- 首帧与帧率均达标（目标：首帧 ≤2s、400 节点 ≥30fps）。
- 400 节点与 20 节点的首帧几乎一致，说明瓶颈主要在首次 chunk 下载/解析，而不是节点数量。
- 冻结标记约 3.4s，其中包含 1.2s 等待布局收敛；用户可在这段时间内看到节点从分散收敛到稳定位置。
- 主包体积与 V2 基本一致，懒加载边界生效。

## 5. 未覆盖

- 低端集显、移动端 Safari、4K 屏未测。
- 真实 400 节点知识库未构造；合成数据不含边，不能代表真实连线密度下的帧率。
- 未测「首帧 >4s 或 5s <20fps」慢设备提示的触发（阈值逻辑有单测，未在真实慢设备上触发）。
- 未做长时间（>10 分钟）内存增长测试。
