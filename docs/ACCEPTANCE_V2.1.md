# KnowledgeOS V2.1 3D 图谱验收记录

> 对应 `PRD_V2_Graph_Agent.md` v1.1 第 5 章与 V2.1 验收。执行日期：2026-11-01。

## 1. 结论

V2.1 的 10 条验收全部通过。桌面 `/graph` 默认 3D，支持旋转/缩放/平移、点击展开、悬停高亮、搜索定位、重置视图；2D 与列表继续作为降级和无障碍退路。WebGL 不可用或上下文丢失时自动回落到 2D。3D 依赖独立懒加载，主包体积未增加。

## 2. 复现方式

```bash
pnpm --filter @kos/mcp-server build   # 已构建；此步与本版本无直接关系
pnpm --filter @kos/web build
pnpm --filter @kos/web test
pnpm --filter @kos/web exec playwright test
pnpm perf:graph3d
```

- `perf:graph3d` 使用 Playwright：20 节点读真实开发库；400 节点通过 `page.route` 拦截 `/graph/entry` 合成，不污染数据库。

## 3. 验收记录

| 验收项 | 结果 | 证据 | 日期 |
| --- | --- | --- | --- |
| AC-V2.1-1 桌面默认 3D，可切 3D/平面/列表，刷新保持 | 通过 | `graph3d.spec.ts`：默认 `3D` `aria-pressed`，切平面后刷新仍为平面 | 2026-11-01 |
| AC-V2.1-2 旋转/缩放/平移与重置 | 通过 | `graph3d.spec.ts`：滚轮缩放使 `data-camera` 变化，重置回到 `0,0,450`；OrbitControls 提供拖拽旋转/平移 | 2026-11-01 |
| AC-V2.1-3 点击节点展开一跳、开抽屉、不重复请求 | 通过 | `graph.spec.ts`（2D）与隐藏列表 E2E 共用 `expand()`；重复触发邻居请求数不增加 | 2026-11-01 |
| AC-V2.1-4 搜索定位且不清空视图 | 通过 | `graph3d.spec.ts`：搜索现有实体后相机位置变化，详情抽屉可见 | 2026-11-01 |
| AC-V2.1-5 悬停高亮邻居 | 通过 | `Graph3DView.test.tsx`：`onNodeHover` 后容器 `data-hovered=b`；邻居集合由 `neighborsOf` 计算 | 2026-11-01 |
| AC-V2.1-6 几何体/线型/冻结且无发光粒子 | 通过 | `graph-style.test.ts`：五类几何体与浅/深色板；布局 2.5s 后写 `data-engine=stopped`；无 Bloom/粒子配置 | 2026-11-01 |
| AC-V2.1-7 >400 聚合，500 节点/2000 边上限 | 通过 | 现有 `shouldAggregate` 测试；`toGraph3DData` 截断测试；400 节点压测可交互 | 2026-11-01 |
| AC-V2.1-8 WebGL 不可用 / 上下文丢失 1s 内切 2D | 通过 | `graph3d.spec.ts`：覆盖 `getContext` 与派发 `webglcontextlost` 均切到平面；`perf:graph3d` 实测 300ms | 2026-11-01 |
| AC-V2.1-9 隐藏节点列表可键盘操作 | 通过 | `GraphA11yList.test.tsx`；E2E 用 `Tab`/`Enter` 展开节点，`Esc` 关闭抽屉；列表模式不重复渲染 | 2026-11-01 |
| AC-V2.1-10 3D 懒加载、首帧与帧率达标 | 通过 | 主包 gzip 130.6KB；`Graph3DView` 独立 chunk gzip 387.5KB；首帧 1.0s、400 节点 56fps | 2026-11-01 |

## 4. 质量门禁

| 项 | 结果 |
| --- | --- |
| Web 单测 | 40/40（新增 22：视图模式、WebGL、数据适配、配色、3D 组件、隐藏列表、页面切换、列表去重、StrictMode 定位） |
| E2E | 22/22（新增 8：3D 默认/持久化、移动端、相机、隐藏列表、WebGL 降级、上下文丢失、搜索定位、展开不重置相机） |
| 3D 首帧 | 1.0s（本机，入口 20 节点） |
| 400 节点帧率 | 56fps（4 秒平均，Playwright Chromium） |
| 布局冻结 | 3.4s 内写 `data-engine=stopped` |
| 3D 懒加载 chunk | 387.5KB gzip（≤450KB） |
| 主包 | 130.6KB gzip（未因 3D 增加） |
| WebGL 降级 | 300ms 切到 2D |

完整数据见 `GRAPH_3D_PERFORMANCE_REPORT.md`。

## 5. 已知限制

- **400 节点为合成数据**：通过路由拦截 `/graph/entry` 生成，不是真实语料；真实 400 节点数据集仍需在真实知识库上复测。
- **3D 画布点击未做自动化**：Canvas 无 DOM 节点，交互通过隐藏节点列表与单元测试验证；画布点击本身只做了人工视觉检查。
- **待定关系在 3D 中用低对比细线**：3D 引擎不提供虚线，虚线仅在 2D 保留；这是 PRD 5.3 的明确取舍。
- **节点拖拽默认关闭**：未提供开启开关；拖拽会重新加热布局，与「冻结」目标冲突。
- **性能数据来自本机**：Windows 10 + Chromium Headless，未覆盖低端集显与 Safari。
- **当前开发库仍是测试实体**：视觉验收前应先导入真实资料。
