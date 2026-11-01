# 平面知识图谱交互补齐 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 `/graph` 的 2D 平面视图补齐到 V2 UIUX 规格：缩放、平移、搜索定位、悬停高亮、边标签、面包屑、展开动画与重置。

**Architecture:** 保留现有 SVG 渲染，不引入图可视化库。新增纯函数视口模块（缩放/平移/坐标换算）和稳定布局模块（已有节点位置不重算，新节点围绕父节点落位）；把 2D 画布抽成 `Graph2DView`，`GraphPage` 继续持有节点、边、展开与抽屉状态。交互通过 SVG 变换与 pointer 事件实现，复用现有隐藏节点列表保证键盘可用。

**Tech Stack:** React 19、TypeScript strict、SVG、Pointer Events、Vitest、React Testing Library、Playwright。

**Spec:** `docs/PRD_V2_Graph_Agent.md` 第 5 章；`docs/UIUX_V2_Graph_Agent.md` 2.2–2.6。

## Global Constraints

- 只改前端 `apps/web`，不改 API、数据模型与检索。
- 2D 仍是 768–1023px 的默认视图，也是 3D 不可用时的降级视图；移动端 ≤767px 继续默认列表。
- 不引入新的图谱渲染依赖；继续使用 SVG。
- 所有动画只做一次性过渡，不做持续力导向抖动；节点位置在展开后不整体重算。
- 缩放范围 0.4–2.5；重置回到 1.0 且视口居中。
- 400 节点以上继续走现有按类型聚合；2D 本身不承担全库渲染。
- 缩放/平移按钮必须可键盘操作；隐藏节点列表继续作为屏幕阅读器入口。
- 所有新增文案使用简体中文；不新增后端字段。

## 现状与缺口

| UIUX 要求 | 当前实现 | 缺口 |
| --- | --- | --- |
| 背景 24px 点阵 | 纯色容器 | 无点阵 |
| 节点类型图标 | 只有形状 | 无图标 |
| 选中光晕 | 只有描边/填充 | 无 6px 光晕 |
| >150 节点 hover 显示标签 | 直接隐藏标签 | 无 hover 标签 |
| 边 hover 显示类型 | 仅原生 `<title>` | 无直接标签 |
| 冲突红色双线 | 单条红线 | 无双线 |
| 展开 180ms 扩散 | 所有节点按索引重算，位置跳动 | 无动画、位置不稳 |
| 搜索平滑平移并高亮 | 合并节点并展开 | 不平移、不聚焦 |
| 面包屑 | 无 | 无 |
| 双击空白重置 | 只清选中 | 不重置视口 |
| 缩放/平移 | 固定 viewBox | 无 |
| 节点无邻居提示 | 无 | 无 |
| 底部图例 | 无 | 无 |

## Review Focus

- 在节点上按下并拖动：应展开节点或拖动画布，不能两者同时发生；拖动阈值建议 4px。
- 搜索一个不在当前视口内的实体：画布应平移到它并高亮，已有节点与边不清空。
- 已经缩放/平移后展开节点：已有节点的屏幕位置不应跳动，新节点只在父节点周围出现。
- 双击空白与双击节点：前者重置视口；后者仍应展开/打开抽屉，不能误重置。
- 缩放后键盘操作：`+ / - / 重置` 按钮与隐藏节点列表仍可用，焦点不被画布吞掉。

---

### Task 1: 视口数学模块

**Files:**
- Create: `apps/web/src/pages/graph/graph-2d-viewport.ts`
- Test: `apps/web/src/pages/graph/graph-2d-viewport.test.ts`

**Interfaces:**
- Produces:
  - `interface Viewport { x: number; y: number; k: number }`
  - `const MIN_ZOOM = 0.4`, `const MAX_ZOOM = 2.5`
  - `function clampViewport(viewport: Viewport): Viewport`
  - `function zoomAt(viewport: Viewport, point: { x: number; y: number }, delta: number): Viewport`
  - `function panBy(viewport: Viewport, dx: number, dy: number): Viewport`
  - `function screenToWorld(viewport: Viewport, point: { x: number; y: number }): { x: number; y: number }`
  - `function worldToScreen(viewport: Viewport, point: { x: number; y: number }): { x: number; y: number }`
  - `function centerOn(point: { x: number; y: number }, width: number, height: number, k?: number): Viewport`

- [ ] **Step 1: 写失败测试**

```ts
import { describe, expect, it } from 'vitest';
import {
  MAX_ZOOM,
  MIN_ZOOM,
  centerOn,
  clampViewport,
  panBy,
  screenToWorld,
  worldToScreen,
  zoomAt,
} from './graph-2d-viewport.js';

describe('graph 2d viewport', () => {
  it('clamps zoom into the allowed range', () => {
    expect(clampViewport({ x: 10, y: 20, k: 0.1 }).k).toBe(MIN_ZOOM);
    expect(clampViewport({ x: 10, y: 20, k: 9 }).k).toBe(MAX_ZOOM);
  });

  it('zooms around the pointer so the world point stays under it', () => {
    const before = { x: 0, y: 0, k: 1 };
    const pointer = { x: 200, y: 120 };
    const world = screenToWorld(before, pointer);
    const after = zoomAt(before, pointer, 1.2);
    const screen = worldToScreen(after, world);
    expect(screen.x).toBeCloseTo(200, 5);
    expect(screen.y).toBeCloseTo(120, 5);
    expect(after.k).toBeGreaterThan(1);
  });

  it('pans and round-trips coordinates', () => {
    const viewport = panBy({ x: 0, y: 0, k: 1.5 }, 30, -20);
    const world = { x: 120, y: 80 };
    expect(worldToScreen(viewport, world)).toEqual({ x: 210, y: 100 });
    expect(screenToWorld(viewport, { x: 210, y: 100 })).toEqual(world);
  });

  it('centers a node at the canvas center', () => {
    const viewport = centerOn({ x: 300, y: 200 }, 900, 620, 1.4);
    expect(viewport).toEqual({ x: 450 - 300 * 1.4, y: 310 - 200 * 1.4, k: 1.4 });
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm --filter @kos/web test -- src/pages/graph/graph-2d-viewport.test.ts`

Expected: FAIL，模块不存在。

- [ ] **Step 3: 实现**

坐标公式固定为 `screen = world * k + offset`，`zoomAt` 先求指针下的 world 点，再调整 offset 保持该点不动；`panBy` 只改 offset；`clampViewport` 把 `k` 限制在 `MIN_ZOOM`–`MAX_ZOOM`。

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm --filter @kos/web test -- src/pages/graph/graph-2d-viewport.test.ts`

Expected: PASS（4 个用例）。

- [ ] **Step 5: 提交**

```bash
git add apps/web/src/pages/graph/graph-2d-viewport.ts apps/web/src/pages/graph/graph-2d-viewport.test.ts
git commit -m "feat(graph): add 2d viewport math"
```

---

### Task 2: 稳定布局模块

**Files:**
- Create: `apps/web/src/pages/graph/graph-2d-layout.ts`
- Test: `apps/web/src/pages/graph/graph-2d-layout.test.ts`

**Interfaces:**
- Consumes: `GraphNode` from `apps/web/src/features/schemas.ts`。
- Produces:
  - `interface Point { x: number; y: number }`
  - `const INITIAL_RADIUS = 240`, `const CHILD_RADIUS = 140`
  - `function initialPosition(id: string, index: number): Point`
  - `function nextPositions(nodes: GraphNode[], existing: Map<string, Point>, parent?: Point): Map<string, Point>`
  - `function angleFor(id: string, index: number): number`

- [ ] **Step 1: 写失败测试**

```ts
import { describe, expect, it } from 'vitest';
import type { GraphNode } from '../../features/schemas.js';
import { initialPosition, nextPositions } from './graph-2d-layout.js';

const node = (id: string): GraphNode => ({
  id,
  name: id,
  type: 'concept',
  aliases: [],
  mentionCount: 1,
  confidence: 0.8,
  mergedIntoId: null,
});

describe('graph 2d layout', () => {
  it('keeps existing positions when new nodes arrive', () => {
    const existing = new Map([['a', { x: 10, y: 20 }]]);
    const next = nextPositions([node('a'), node('b')], existing);
    expect(next.get('a')).toEqual({ x: 10, y: 20 });
    expect(next.get('b')).toBeDefined();
    expect(next.get('b')).not.toEqual({ x: 10, y: 20 });
  });

  it('places new nodes around the expanded parent', () => {
    const parent = { x: 450, y: 310 };
    const next = nextPositions([node('a'), node('b'), node('c')], new Map([['a', parent]]), parent);
    for (const id of ['b', 'c']) {
      const point = next.get(id)!;
      const distance = Math.hypot(point.x - parent.x, point.y - parent.y);
      expect(distance).toBeGreaterThan(80);
      expect(distance).toBeLessThan(220);
    }
  });

  it('initial positions are deterministic per id', () => {
    const a = initialPosition('entity-a', 0);
    const b = initialPosition('entity-a', 0);
    expect(b).toEqual(a);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm --filter @kos/web test -- src/pages/graph/graph-2d-layout.test.ts`

Expected: FAIL，模块不存在。

- [ ] **Step 3: 实现**

已有位置原样保留；缺位置的新节点用 `id` 哈希 + 序号算角度：有父节点时以 `parent` 为圆心、`CHILD_RADIUS` 为半径；无父节点时围绕画布中心 `(450, 310)`、`INITIAL_RADIUS` 为半径。不得按 visibleNodes 索引重算整张图。

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm --filter @kos/web test -- src/pages/graph/graph-2d-layout.test.ts`

Expected: PASS（3 个用例）。

- [ ] **Step 5: 提交**

```bash
git add apps/web/src/pages/graph/graph-2d-layout.ts apps/web/src/pages/graph/graph-2d-layout.test.ts
git commit -m "feat(graph): add stable 2d layout"
```

---

### Task 3: 抽出 Graph2DView，接入缩放/平移/重置

**Files:**
- Create: `apps/web/src/pages/graph/Graph2DView.tsx`
- Test: `apps/web/src/pages/graph/Graph2DView.test.tsx`
- Modify: `apps/web/src/pages/graph/GraphPage.tsx`

**Interfaces:**
- Consumes: `Viewport`、`zoomAt`、`panBy`、`centerOn`、`nextPositions`。
- Produces:
  - `interface Graph2DViewHandle { focusNode(id: string): void; resetView(): void }`
  - `interface Graph2DViewProps { nodes: GraphNode[]; edges: GraphEdge[]; selected: string | null; expanded: Set<string>; onSelect: (id: string | null) => void; onExpand: (node: GraphNode) => void; onBackgroundDoubleClick: () => void }`
  - 画布容器 `data-testid="graph2d-canvas"`，并带 `data-viewport="x,y,k"`。

- [ ] **Step 1: 写失败测试**

```tsx
import { createRef } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Graph2DView, type Graph2DViewHandle } from './Graph2DView.js';

const nodes = [
  { id: 'a', name: 'A', type: 'concept', aliases: [], mentionCount: 1, confidence: 0.8, mergedIntoId: null },
  { id: 'b', name: 'B', type: 'technology', aliases: [], mentionCount: 1, confidence: 0.8, mergedIntoId: null },
];

it('zooms with buttons and resets the viewport', async () => {
  const ref = createRef<Graph2DViewHandle>();
  render(<Graph2DView ref={ref} nodes={nodes} edges={[]} selected={null} expanded={new Set()} onSelect={vi.fn()} onExpand={vi.fn()} onBackgroundDoubleClick={vi.fn()} />);

  const canvas = screen.getByTestId('graph2d-canvas');
  expect(canvas).toHaveAttribute('data-viewport', '0,0,1');

  await userEvent.click(screen.getByRole('button', { name: '放大' }));
  expect(canvas.getAttribute('data-viewport')).not.toBe('0,0,1');

  await userEvent.click(screen.getByRole('button', { name: '重置视图' }));
  expect(canvas).toHaveAttribute('data-viewport', '0,0,1');
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm --filter @kos/web test -- src/pages/graph/Graph2DView.test.tsx`

Expected: FAIL，组件不存在。

- [ ] **Step 3: 实现**

- 把 `GraphPage` 内现有 SVG 渲染、`positionOf`、`shapeFor` 迁入 `Graph2DView`，页面只保留数据与回调。
- 外层 SVG 固定 `viewBox="0 0 900 620"`；内层 `<g>` 应用 `translate(x,y) scale(k)`。
- 容器上方浮层放「放大 / 缩小 / 重置视图」三个按钮；重置为 `{x:0,y:0,k:1}`。
- 滚轮 `zoomAt`（阻止页面滚动）；空白处 pointerdown+move 平移，4px 内视为点击。
- 暴露 `focusNode(id)` / `resetView()`。
- 现有节点点击、抽屉、来源跳转保持行为。

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm --filter @kos/web test -- src/pages/graph/Graph2DView.test.tsx`

Expected: PASS。

- [ ] **Step 5: 更新 GraphPage 与现有 E2E**

`GraphPage` 用 `<Graph2DView />` 替换内联 SVG；`graph.spec.ts` 的节点定位仍在 `graph2d-canvas` 内，保持可见。

- [ ] **Step 6: 运行**

Run: `pnpm --filter @kos/web test -- src/pages/graph/Graph2DView.test.tsx`

Run: `pnpm --filter @kos/web exec playwright test e2e/graph.spec.ts e2e/graph3d.spec.ts`

Expected: PASS。

- [ ] **Step 7: 提交**

```bash
git add apps/web/src/pages/graph/Graph2DView.tsx apps/web/src/pages/graph/Graph2DView.test.tsx \
  apps/web/src/pages/graph/GraphPage.tsx
git commit -m "feat(graph): extract 2d view with pan and zoom"
```

---

### Task 4: 搜索聚焦、面包屑与双击重置

**Files:**
- Modify: `apps/web/src/pages/graph/Graph2DView.tsx`
- Modify: `apps/web/src/pages/graph/GraphPage.tsx`
- Test: `apps/web/src/pages/graph/GraphPage.test.tsx`
- Test: `apps/web/e2e/graph2d.spec.ts`

**Interfaces:**
- Produces: `Graph2DViewHandle.focusNode(id)` 将目标节点居中并保持当前缩放（最低 1.2）。
- Produces: `GraphPage` 的 `focusPath: string[]`；展开节点时追加，面包屑按钮 `name = 节点名`。
- `data-viewport` 在聚焦后变化；双击空白重置视口并清空 `focusPath`。

- [ ] **Step 1: 写失败测试**

```tsx
it('search focuses the selected entity and breadcrumb can navigate back', async () => {
  // mock useWikiEntities 返回 [{ id:'a', canonicalName:'RRF', ... }]
  render(<MemoryRouter><GraphPage /></MemoryRouter>);
  await userEvent.click(screen.getByRole('button', { name: '平面' }));
  await userEvent.type(screen.getByLabelText('搜索实体'), 'RRF');
  await userEvent.click(screen.getByRole('button', { name: 'RRF', exact: true }));
  expect(screen.getByRole('button', { name: 'RRF' })).toHaveAttribute('aria-pressed', 'true');
  expect(screen.getByRole('navigation', { name: '图谱路径' })).toBeInTheDocument();
});
```

E2E 增加：

```ts
test('2d search centers a node and breadcrumb navigates', async ({ page }) => {
  await page.goto('/graph');
  await page.getByRole('button', { name: '平面', exact: true }).click();
  const canvas = page.getByTestId('graph2d-canvas');
  const before = await canvas.getAttribute('data-viewport');
  await page.getByLabel('搜索实体').fill('E2EGraph');
  const results = page.getByTestId('entity-search-results');
  await results.getByRole('button', { name: /E2EGraph/ }).first().click();
  await expect.poll(() => canvas.getAttribute('data-viewport')).not.toBe(before);
  await expect(page.getByRole('navigation', { name: '图谱路径' })).toBeVisible();
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm --filter @kos/web test -- src/pages/graph/GraphPage.test.tsx`

Expected: FAIL，无 `data-viewport` / 面包屑。

- [ ] **Step 3: 实现**

- 搜索结果点击：`mergeNeighborhood` → `expand(node)` → `graph2DRef.current?.focusNode(node.id)`；不要清空 `nodes/edges`。给搜索下拉容器加 `data-testid="entity-search-results"`，避免 E2E 命中隐藏节点列表。
- 展开节点时维护 `focusPath`：如果最后一项不是当前节点则追加；已有节点重复展开不改变路径。
- 顶部渲染 `<nav aria-label="图谱路径">`，每项一个按钮；点击调用 `focusNode` 并 `setSelected`，不卸载节点。
- 空白双击调用 `onBackgroundDoubleClick`：重置视口、清空 `selected` 与 `focusPath`。

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm --filter @kos/web test -- src/pages/graph/GraphPage.test.tsx`

Run: `pnpm --filter @kos/web exec playwright test e2e/graph2d.spec.ts`

Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add apps/web/src/pages/graph/Graph2DView.tsx apps/web/src/pages/graph/GraphPage.tsx \
  apps/web/src/pages/graph/GraphPage.test.tsx apps/web/e2e/graph2d.spec.ts
git commit -m "feat(graph): add 2d search focus and breadcrumbs"
```

---

### Task 5: 悬停高亮、边标签与视觉编码

**Files:**
- Modify: `apps/web/src/pages/graph/Graph2DView.tsx`
- Create: `apps/web/src/pages/graph/graph-node-icon.tsx`
- Test: `apps/web/src/pages/graph/Graph2DView.test.tsx`
- Test: `apps/web/src/pages/graph/graph-node-icon.test.tsx`

**Interfaces:**
- Produces: `NodeIcon({ type }: { type: string })` 输出 14px 线性图标；Concept 圆点、Technology 方块、Project 文件夹、Agent 机器人、Protocol 连线。
- `Graph2DView` 内部 `hoveredNode` / `hoveredEdge`；节点 hover 时邻居集合复用 `neighborsOf()`。

- [ ] **Step 1: 写失败测试**

```tsx
it('shows relation type when hovering an edge and dims unrelated nodes', async () => {
  render(<Graph2DView nodes={nodes} edges={[edge]} selected={null} expanded={new Set()} onSelect={vi.fn()} onExpand={vi.fn()} onBackgroundDoubleClick={vi.fn()} />);
  const hit = screen.getByTestId('edge-hit-e1');
  await userEvent.hover(hit);
  expect(screen.getByText('USES')).toBeVisible();
});

it('renders an icon for each node type', () => {
  render(<NodeIcon type="technology" />);
  expect(screen.getByTestId('node-icon-technology')).toBeInTheDocument();
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm --filter @kos/web test -- src/pages/graph/Graph2DView.test.tsx src/pages/graph/graph-node-icon.test.tsx`

Expected: FAIL。

- [ ] **Step 3: 实现**

- 背景加 `<pattern id="dot-grid">`（24px，`--line` 40% 透明度）固定铺在画布底层。
- 节点内加 `NodeIcon`；选中节点额外画 `r = size + 6` 的 accent 光晕（12% 透明度）。
- 每条边加透明命中线 `strokeWidth=12`，hover 时在中点渲染关系类型文本。
- 冲突关系画两条平行线（垂直偏移 ±2）；待定关系保留虚线。
- >150 节点时只显示选中、hover 与直接邻居标签。

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm --filter @kos/web test -- src/pages/graph/Graph2DView.test.tsx src/pages/graph/graph-node-icon.test.tsx`

Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add apps/web/src/pages/graph/Graph2DView.tsx apps/web/src/pages/graph/graph-node-icon.tsx \
  apps/web/src/pages/graph/graph-node-icon.test.tsx apps/web/src/pages/graph/Graph2DView.test.tsx
git commit -m "feat(graph): add 2d hover, edge labels and visual encoding"
```

---

### Task 6: 展开动画、无邻居提示与图例

**Files:**
- Modify: `apps/web/src/pages/graph/Graph2DView.tsx`
- Modify: `apps/web/src/styles/globals.css`
- Test: `apps/web/src/pages/graph/Graph2DView.test.tsx`
- Test: `apps/web/e2e/graph2d.spec.ts`

**Interfaces:**
- Produces: 新节点 `<g>` 带 `data-entering="true"` 与 CSS 变量 `--from-x/--from-y`；动画 180ms 后移除标记。
- Produces: 选中节点无邻居时画布底部显示「该概念暂未建立关系」。
- Produces: 底部图例条（形状/图标 + 关系线型）。

- [ ] **Step 1: 写失败测试**

```tsx
it('marks newly added nodes as entering', () => {
  const { rerender } = render(<Graph2DView nodes={[nodes[0]!]} ... />);
  rerender(<Graph2DView nodes={nodes} ... />);
  expect(screen.getByTestId('node-b')).toHaveAttribute('data-entering', 'true');
});
```

E2E：

```ts
test('2d expansion animates once and keeps existing nodes stable', async ({ page }) => {
  await page.goto('/graph');
  await page.getByRole('button', { name: '平面', exact: true }).click();
  const canvas = page.getByTestId('graph2d-canvas');
  const node = canvas.getByRole('button', { name: /^节点 / }).first();
  const before = await node.getAttribute('transform');
  await node.click({ force: true });
  await page.waitForTimeout(300);
  expect(await node.getAttribute('transform')).toBe(before);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm --filter @kos/web test -- src/pages/graph/Graph2DView.test.tsx`

Expected: FAIL。

- [ ] **Step 3: 实现**

- 新节点以父节点坐标为起点，CSS keyframes 180ms 过渡到目标位置并淡入；已有节点 transform 不变。
- `selected` 且 `edges` 中没有相邻边时显示空关系提示。
- 底部图例用小型 SVG + 文案，不新增颜色令牌。

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm --filter @kos/web test -- src/pages/graph/Graph2DView.test.tsx`

Run: `pnpm --filter @kos/web exec playwright test e2e/graph2d.spec.ts`

Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add apps/web/src/pages/graph/Graph2DView.tsx apps/web/src/styles/globals.css \
  apps/web/src/pages/graph/Graph2DView.test.tsx apps/web/e2e/graph2d.spec.ts
git commit -m "feat(graph): animate 2d expansion and add legend"
```

---

### Task 7: 验收与全量门禁

**Files:**
- Create: `docs/ACCEPTANCE_V2.2.md`
- Modify: `docs/PROGRESS.md`
- Modify: `docs/README.md`

**Interfaces:**
- Consumes: 前 6 个任务的实现。
- Produces: V2.2 平面交互验收记录（缩放/平移、搜索、面包屑、悬停、动画、键盘）。

- [ ] **Step 1: 写验收记录**

按以下 8 条逐项记录证据：

1. 平面视图可滚轮缩放、拖拽平移、按钮重置。
2. 搜索实体后画布平移并高亮，已有视图不清空。
3. 展开节点后已有节点位置不变，新节点从父节点方向出现。
4. 多跳展开出现面包屑，点击任一层可回到该节点。
5. 悬停节点高亮直接邻居；悬停边显示关系类型。
6. >150 节点时标签按 hover/选中/邻居显示。
7. 冲突关系双线、待定虚线、节点图标可区分类型。
8. 键盘可操作缩放按钮与隐藏节点列表；双击空白重置。

- [ ] **Step 2: 跑门禁**

```bash
pnpm lint
pnpm typecheck
pnpm build
pnpm --filter @kos/web test
pnpm --filter @kos/web exec playwright test
```

Expected: 全绿。

- [ ] **Step 3: 更新台账与文档索引**

`PROGRESS.md` 增加 V2.2 看板与门禁行；`README.md` 索引增加 `ACCEPTANCE_V2.2.md`。

- [ ] **Step 4: 提交**

```bash
git add docs/ACCEPTANCE_V2.2.md docs/PROGRESS.md docs/README.md
git commit -m "docs(graph): record v2.2 2d interaction acceptance"
```

---

## 方案对比

| 方案 | 做法 | 工作量 | 风险 |
| --- | --- | --- | --- |
| **A（推荐）** | 现有 SVG + 视口/布局纯函数 + pointer 事件 | 4–5 天 | 低，保持设计语言与无障碍 |
| B | 引入 `d3-zoom` 只做缩放/平移 | 3–4 天 | 低，但多一个依赖，仍要自己做布局/动画 |
| C | 换成 `react-force-graph-2d` 或 G6 | 5–7 天 | 中高，视觉与现有「纸与索引」冲突，可访问性回退 |
| D | 只做缩放/平移 | 1.5–2 天 | 低，但搜索/悬停/面包屑仍缺 |

## 不在本计划

- 平面视图的力导向布局；节点拖拽；全库渲染。
- 3D 视图改动。
- 图谱数据质量与抽取准确率。
