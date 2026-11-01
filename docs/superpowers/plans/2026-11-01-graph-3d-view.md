# 3D 知识图谱视图与交互 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 `/graph` 的桌面默认视图升级为可旋转、缩放、展开、搜索定位的 3D 知识图谱，同时保留 2D 与列表作为降级和无障碍退路。

**Architecture:** 使用 `react-force-graph-3d`（Three.js/WebGL）作为 3D 渲染层，路由级懒加载；现有 `GraphPage` 的节点/边状态、展开接口与详情抽屉保持不变，只新增视图模式与相机控制。数据适配、视图模式判断、配色与标签规则抽成可单测的纯函数；WebGL 不可用或上下文丢失时切回现有 2D SVG。

**Tech Stack:** React 19、TypeScript strict、Vite 5、`react-force-graph-3d@^1.29`、`three@^0.187`、`three-spritetext`、Vitest、React Testing Library、Playwright。

**Spec:** `docs/PRD_V2_Graph_Agent.md`（v1.1，第 5 章与 V2.1 验收）

## Global Constraints

- 只改前端 `apps/web`；不改 API、数据库、检索与图谱构建。
- 桌面 ≥1024px 默认 3D；768–1023px 默认 2D；≤767px 默认列表。
- WebGL 不可用、上下文丢失，或用户选择 2D/列表时，必须仍能完成「展开、查看详情、跳原文」。
- 3D 必须路由级懒加载；`react-force-graph-3d` + `three` 不得进入其他页面首屏。
- 3D 硬上限 500 节点 / 2000 边；节点数 >400 继续走现有按类型聚合界面。
- 禁止发光、Bloom、渐变连线、粒子流、持续力导向抖动；布局在 `cooldownTicks=120` 后冻结。
- 节点类型用几何体区分；颜色只用于选中与冲突。
- 所有新增 UI 文案使用简体中文；不新增后端字段。
- 复用现有 `GraphNode` / `GraphEdge` / `expand()` / 详情抽屉，不复制数据逻辑。
- 每完成一个任务运行 `pnpm --filter @kos/web test` 与 `pnpm --filter @kos/web typecheck`，最后运行全量门禁。

## Review Focus

- WebGL 不可用或运行中丢失上下文：用户应看到 2D 视图与提示，而不是空白画布或卡死。
- 窗口从宽屏缩到 ≤1023px：3D 不应继续初始化或占用 WebGL 上下文；默认视图应按断点回落。
- 快速连续展开、搜索定位与重置：不应出现重复邻居请求、相机飞到旧节点或选中状态错位。
- 深色/浅色主题切换时 3D 已挂载：Three.js 不读 CSS 变量，颜色必须随主题重新计算。
- 键盘与屏幕阅读器：视觉隐藏的节点列表必须能完成选中/展开，且不制造重复 Tab 陷阱。

---

### Task 1: 视图模式与 WebGL 能力判断

**Files:**
- Create: `apps/web/src/lib/graph-view.ts`
- Create: `apps/web/src/lib/webgl.ts`
- Test: `apps/web/src/lib/graph-view.test.ts`
- Test: `apps/web/src/lib/webgl.test.ts`
- Modify: `docs/UIUX_V2_Graph_Agent.md`（新增 3D 增补章节，描述三态切换、视觉约束与降级）

**Interfaces:**
- Produces:
  - `type GraphViewMode = '3d' | '2d' | 'list'`
  - `const GRAPH_VIEW_STORAGE_KEY = 'kos-graph-view'`
  - `function canUse3D(width: number, webgl: boolean): boolean`
  - `function defaultViewMode(width: number, webgl: boolean): GraphViewMode`
  - `function resolveViewMode(saved: string | null, width: number, webgl: boolean): GraphViewMode`
  - `function supportsWebGL(): boolean`
  - `function shouldOfferFallback(firstFrameMs: number, fps: number): boolean`

- [ ] **Step 1: 写失败测试**

```ts
// apps/web/src/lib/graph-view.test.ts
import { describe, expect, it } from 'vitest';
import {
  canUse3D,
  defaultViewMode,
  resolveViewMode,
  shouldOfferFallback,
} from './graph-view.js';

describe('图谱视图模式', () => {
  it('桌面且 WebGL 可用时默认 3D', () => {
    expect(defaultViewMode(1440, true)).toBe('3d');
    expect(canUse3D(1024, true)).toBe(true);
  });

  it('窄屏或 WebGL 不可用时回落', () => {
    expect(defaultViewMode(900, true)).toBe('2d');
    expect(defaultViewMode(390, true)).toBe('list');
    expect(defaultViewMode(1440, false)).toBe('2d');
    expect(canUse3D(390, true)).toBe(false);
  });

  it('已保存的选择优先，但不允许在不可用环境恢复 3D', () => {
    expect(resolveViewMode('list', 1440, true)).toBe('list');
    expect(resolveViewMode('2d', 1440, true)).toBe('2d');
    expect(resolveViewMode('3d', 390, true)).toBe('list');
    expect(resolveViewMode('3d', 1440, false)).toBe('2d');
    expect(resolveViewMode('unknown', 1440, true)).toBe('3d');
  });

  it('首帧过慢或帧率过低时提示切换', () => {
    expect(shouldOfferFallback(4100, 60)).toBe(true);
    expect(shouldOfferFallback(1200, 19)).toBe(true);
    expect(shouldOfferFallback(1200, 30)).toBe(false);
  });
});
```

```ts
// apps/web/src/lib/webgl.test.ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import { supportsWebGL } from './webgl.js';

afterEach(() => vi.restoreAllMocks());

describe('supportsWebGL', () => {
  it('拿不到上下文时返回 false', () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    expect(supportsWebGL()).toBe(false);
  });

  it('拿到 webgl2 上下文时返回 true', () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({} as never);
    expect(supportsWebGL()).toBe(true);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm --filter @kos/web test -- src/lib/graph-view.test.ts src/lib/webgl.test.ts`

Expected: FAIL，提示模块 `./graph-view.js` / `./webgl.js` 不存在。

- [ ] **Step 3: 实现纯函数**

`graph-view.ts` 规则：

```ts
export function canUse3D(width: number, webgl: boolean): boolean {
  return webgl && width >= 1024;
}

export function defaultViewMode(width: number, webgl: boolean): GraphViewMode {
  if (width <= 767) return 'list';
  if (!canUse3D(width, webgl)) return '2d';
  return '3d';
}

export function resolveViewMode(
  saved: string | null,
  width: number,
  webgl: boolean,
): GraphViewMode {
  const fallback = defaultViewMode(width, webgl);
  if (saved === '2d' || saved === 'list') return saved;
  if (saved === '3d') return canUse3D(width, webgl) ? '3d' : fallback;
  return fallback;
}
```

`supportsWebGL` 用一次性 `canvas.getContext('webgl2') ?? canvas.getContext('webgl')`；异常时返回 false。`shouldOfferFallback(firstFrameMs, fps)` 返回 `firstFrameMs > 4000 || fps < 20`。

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm --filter @kos/web test -- src/lib/graph-view.test.ts src/lib/webgl.test.ts`

Expected: PASS（6 个用例）。

- [ ] **Step 5: 更新 UIUX 文档**

在 `docs/UIUX_V2_Graph_Agent.md` 增加「2.6 3D 视图（V2.1）」：三态切换、轨道相机、冻结布局、几何体编码、空/慢/WebGL 不可用三态文案、键盘与隐藏列表。不要改动已有 2D 规格。

- [ ] **Step 6: 提交**

```bash
git add apps/web/src/lib/graph-view.ts apps/web/src/lib/webgl.ts \
  apps/web/src/lib/graph-view.test.ts apps/web/src/lib/webgl.test.ts \
  docs/UIUX_V2_Graph_Agent.md
git commit -m "feat(graph): add 3d view mode and webgl capability checks"
```

---

### Task 2: 3D 数据适配与视觉常量

**Files:**
- Create: `apps/web/src/pages/graph/graph-data.ts`
- Create: `apps/web/src/pages/graph/graph-style.ts`
- Test: `apps/web/src/pages/graph/graph-data.test.ts`
- Test: `apps/web/src/pages/graph/graph-style.test.ts`

**Interfaces:**
- Consumes: `GraphNode` / `GraphEdge` from `apps/web/src/features/schemas.ts`。
- Produces:
  - `interface Graph3DNode { id: string; name: string; type: string; val: number; x?: number; y?: number; z?: number }`
  - `interface Graph3DLink { id: string; source: string; target: string; type: string; status: string }`
  - `interface Graph3DLimits { maxNodes?: number; maxLinks?: number }`
  - `function toGraph3DData(nodes: Iterable<GraphNode>, edges: Iterable<GraphEdge>, limits?: Graph3DLimits): { nodes: Graph3DNode[]; links: Graph3DLink[]; truncated: boolean; originalNodes: number; originalLinks: number }`
  - `function neighborsOf(edges: Iterable<GraphEdge>, id: string): Set<string>`
  - `function labelVisible(total: number, id: string, state: { selected: string | null; hovered: string | null; neighbors: Set<string> }): boolean`
  - `interface GraphPalette { canvas: string; node: string; selected: string; link: string; conflict: string; text: string }`
  - `function graphPalette(resolved: 'light' | 'dark'): GraphPalette`
  - `type NodeGeometry = 'sphere' | 'box' | 'tetra' | 'octa' | 'prism'`
  - `function geometryFor(type: string): NodeGeometry`

- [ ] **Step 1: 写失败测试**

```ts
// graph-data.test.ts
import { describe, expect, it } from 'vitest';
import { labelVisible, neighborsOf, toGraph3DData } from './graph-data.js';

const node = (id: string): any => ({
  id,
  name: id,
  type: 'concept',
  aliases: [],
  mentionCount: 1,
  confidence: 0.8,
  mergedIntoId: null,
});
const edge = (id: string, fromId: string, toId: string): any => ({
  id,
  fromId,
  toId,
  type: 'USES',
  confidence: 0.9,
  evidenceChunkIds: [],
  status: 'active',
  origin: 'model',
  direction: 'out',
});

describe('toGraph3DData', () => {
  it('把 fromId/toId 转成 source/target，并丢掉悬空边', () => {
    const result = toGraph3DData([node('a'), node('b')], [edge('e1', 'a', 'b'), edge('e2', 'a', 'missing')]);
    expect(result.nodes.map((n) => n.id)).toEqual(['a', 'b']);
    expect(result.links).toEqual([
      { id: 'e1', source: 'a', target: 'b', type: 'USES', status: 'active' },
    ]);
    expect(result.truncated).toBe(false);
  });

  it('超过上限时截断并标记原始数量', () => {
    const nodes = Array.from({ length: 6 }, (_, i) => node(`n${i}`));
    const edges = Array.from({ length: 6 }, (_, i) => edge(`e${i}`, `n${i}`, `n${i + 1}`));
    const result = toGraph3DData(nodes, edges, { maxNodes: 3, maxLinks: 2 });
    expect(result.nodes).toHaveLength(3);
    expect(result.links).toHaveLength(2);
    expect(result.truncated).toBe(true);
    expect(result.originalNodes).toBe(6);
    expect(result.originalLinks).toBe(6);
  });
});

describe('neighborsOf / labelVisible', () => {
  it('返回出入边的直接邻居', () => {
    expect([...neighborsOf([edge('e1', 'a', 'b'), edge('e2', 'c', 'a')], 'a')]).toEqual(['b', 'c']);
  });

  it('150 内全部显示；超过后只显示选中、hover 与邻居', () => {
    const neighbors = new Set(['b']);
    expect(labelVisible(150, 'c', { selected: null, hovered: null, neighbors })).toBe(true);
    expect(labelVisible(200, 'c', { selected: null, hovered: null, neighbors })).toBe(false);
    expect(labelVisible(200, 'b', { selected: null, hovered: null, neighbors })).toBe(true);
    expect(labelVisible(200, 'c', { selected: 'c', hovered: null, neighbors })).toBe(true);
    expect(labelVisible(200, 'c', { selected: null, hovered: 'c', neighbors })).toBe(true);
  });
});
```

```ts
// graph-style.test.ts
import { describe, expect, it } from 'vitest';
import { geometryFor, graphPalette } from './graph-style.js';

describe('graph style', () => {
  it('主题色不同且完整', () => {
    const light = graphPalette('light');
    const dark = graphPalette('dark');
    expect(Object.keys(light)).toEqual(['canvas', 'node', 'selected', 'link', 'conflict', 'text']);
    expect(light.canvas).not.toBe(dark.canvas);
    expect(light.selected).toBeTruthy();
  });

  it('按类型返回几何体', () => {
    expect(geometryFor('concept')).toBe('sphere');
    expect(geometryFor('technology')).toBe('box');
    expect(geometryFor('agent')).toBe('octa');
    expect(geometryFor('unknown')).toBe('sphere');
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm --filter @kos/web test -- src/pages/graph/graph-data.test.ts src/pages/graph/graph-style.test.ts`

Expected: FAIL，模块不存在。

- [ ] **Step 3: 实现 adapter 与常量**

`toGraph3DData` 必须先按 `maxNodes` 截断节点集合，再过滤两端都存在的边，最后按 `maxLinks` 截断；`truncated` 表示任一维度被截断。颜色使用现有主题解析后的十六进制值（Three.js 不读 CSS 变量），并保证浅/深两套都满足正文对比度。

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm --filter @kos/web test -- src/pages/graph/graph-data.test.ts src/pages/graph/graph-style.test.ts`

Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add apps/web/src/pages/graph/graph-data.ts apps/web/src/pages/graph/graph-style.ts \
  apps/web/src/pages/graph/graph-data.test.ts apps/web/src/pages/graph/graph-style.test.ts
git commit -m "feat(graph): add 3d data adapter and palette"
```

---

### Task 3: 3D 视图组件（懒加载、冻结布局、几何体）

**Files:**
- Modify: `apps/web/package.json`、`pnpm-lock.yaml`
- Create: `apps/web/src/pages/graph/Graph3DView.tsx`
- Test: `apps/web/src/pages/graph/Graph3DView.test.tsx`
- Modify: `apps/web/src/styles/globals.css`（`.graph-3d` 容器与 canvas 尺寸）

**Interfaces:**
- Consumes: `toGraph3DData`、`graphPalette`、`geometryFor`、`labelVisible`。
- Produces:
  - `interface Graph3DViewHandle { focusNode(id: string): void; resetView(): void }`
  - `interface Graph3DViewProps { nodes: GraphNode[]; edges: GraphEdge[]; selected: string | null; onSelect: (id: string | null) => void; onExpand: (node: GraphNode) => void; onEngineStop?: () => void; onCameraChange?: (position: { x: number; y: number; z: number }) => void; onContextLost?: () => void; onSlow?: () => void }`
  - `const Graph3DView = forwardRef<Graph3DViewHandle, Graph3DViewProps>(...)`

- [ ] **Step 1: 安装依赖**

```bash
pnpm --filter @kos/web add react-force-graph-3d@^1.29.2 three@^0.187.0 three-spritetext@^1.10.0
```

- [ ] **Step 2: 写失败测试**

```tsx
// Graph3DView.test.tsx
import { act, createRef } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Graph3DView, type Graph3DViewHandle } from './Graph3DView.js';

vi.mock('react-force-graph-3d', async () => {
  const React = await import('react');
  return {
    default: React.forwardRef(function Mock(props: any, ref: any) {
      React.useImperativeHandle(ref, () => ({
        cameraPosition: vi.fn(),
        d3ReheatSimulation: vi.fn(),
        pauseAnimation: vi.fn(),
      }));
      return (
        <button
          data-testid="mock-force-graph"
          data-nodes={props.graphData.nodes.length}
          data-cooldown={String(props.cooldownTicks)}
          data-control={String(props.controlType)}
          data-drag={String(props.enableNodeDrag)}
          onClick={() => props.onNodeClick(props.graphData.nodes[0])}
        >
          mock
        </button>
      );
    }),
  };
});

const nodes = [
  { id: 'a', name: 'A', type: 'concept', aliases: [], mentionCount: 1, confidence: 0.8, mergedIntoId: null },
  { id: 'b', name: 'B', type: 'technology', aliases: [], mentionCount: 1, confidence: 0.8, mergedIntoId: null },
];
const edges = [
  { id: 'e1', fromId: 'a', toId: 'b', type: 'USES', confidence: 0.9, evidenceChunkIds: [], status: 'active', origin: 'model', direction: 'out' },
];

describe('Graph3DView', () => {
  it('懒加载后传入冻结配置并转发节点点击', async () => {
    const onSelect = vi.fn();
    const onExpand = vi.fn();
    const ref = createRef<Graph3DViewHandle>();
    render(<Graph3DView ref={ref} nodes={nodes} edges={edges} selected={null} onSelect={onSelect} onExpand={onExpand} />);

    const graph = await screen.findByTestId('mock-force-graph');
    expect(graph).toHaveAttribute('data-nodes', '2');
    expect(graph).toHaveAttribute('data-cooldown', '120');
    expect(graph).toHaveAttribute('data-control', 'orbit');
    expect(graph).toHaveAttribute('data-drag', 'false');

    await userEvent.click(graph);
    expect(onSelect).toHaveBeenCalledWith('a');
    expect(onExpand).toHaveBeenCalledWith(nodes[0]);
  });
});
```

- [ ] **Step 3: 运行测试确认失败**

Run: `pnpm --filter @kos/web test -- src/pages/graph/Graph3DView.test.tsx`

Expected: FAIL，组件不存在（或 mock 未被懒加载模块命中）。

- [ ] **Step 4: 实现 `Graph3DView`**

要求：
- 用 `lazy(() => import('react-force-graph-3d'))` + `Suspense` 骨架加载。
- `graphData` 由 `toGraph3DData(nodes, edges)` 生成。
- 固定配置：`controlType="orbit"`、`cooldownTicks={120}`、`warmupTicks={40}`、`enableNodeDrag={false}`、`nodeRelSize={5}`、`linkOpacity={0.35}`。
- `onEngineStop` 调用 `pauseAnimation?.()` 并向上报告。
- `onNodeClick` 调 `onSelect(node.id)` 与 `onExpand(node)`；`onBackgroundClick` 调 `onSelect(null)`。
- `useImperativeHandle` 暴露 `focusNode(id)`（`cameraPosition` 飞到节点）与 `resetView()`（回到默认机位）；节点没有坐标时先 `d3ReheatSimulation()`。
- 节点几何体用 `geometryFor`；标签用 `three-spritetext`，按 `labelVisible` 决定是否挂载。
- 通过 `useTheme().resolved` 取 `graphPalette`，主题变化时重新计算颜色。
- 容器 `data-testid="graph3d-view"`，高度 620，宽度跟随父容器。

- [ ] **Step 5: 运行测试确认通过**

Run: `pnpm --filter @kos/web test -- src/pages/graph/Graph3DView.test.tsx`

Expected: PASS。

- [ ] **Step 6: 提交**

```bash
git add apps/web/package.json pnpm-lock.yaml apps/web/src/pages/graph/Graph3DView.tsx \
  apps/web/src/pages/graph/Graph3DView.test.tsx apps/web/src/styles/globals.css
git commit -m "feat(graph): add lazy 3d graph view component"
```

---

### Task 4: GraphPage 接入三态切换与持久化

**Files:**
- Modify: `apps/web/src/pages/graph/GraphPage.tsx`
- Modify: `apps/web/e2e/graph.spec.ts`（现有 2D 用例先切到「平面」）
- Create: `apps/web/e2e/graph3d.spec.ts`
- Test: `apps/web/src/pages/graph/GraphPage.test.tsx`

**Interfaces:**
- Consumes: `GraphViewMode`、`resolveViewMode`、`GRAPH_VIEW_STORAGE_KEY`、`Graph3DView`、`Graph3DViewHandle`。
- Produces: 视图工具条的按钮名固定为 `3D`、`平面`、`列表`；页面根节点带 `data-view-mode`。

- [ ] **Step 1: 写失败测试**

```tsx
// GraphPage.test.tsx（mock 数据 hooks 与 3D 组件）
it('桌面默认 3D，切换平面后写入 localStorage', async () => {
  // mock useGraphEntry 返回 2 个节点、useGraphPending 返回 []
  render(<GraphPage />, { wrapper: Providers });
  expect(await screen.findByRole('button', { name: '3D' })).toHaveAttribute('aria-pressed', 'true');
  await userEvent.click(screen.getByRole('button', { name: '平面' }));
  expect(await screen.findByTestId('graph2d-canvas')).toBeInTheDocument();
  expect(localStorage.getItem(GRAPH_VIEW_STORAGE_KEY)).toBe('2d');
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm --filter @kos/web test -- src/pages/graph/GraphPage.test.tsx`

Expected: FAIL，找不到 `3D` 按钮 / 仍使用 `listView` 布尔值。

- [ ] **Step 3: 修改 GraphPage**

- 把 `listView` 布尔值替换为 `viewMode`，初始值 `resolveViewMode(localStorage.getItem(GRAPH_VIEW_STORAGE_KEY), window.innerWidth, supportsWebGL())`。
- 增加 `useEffect` 监听 `resize`：跨过 1024/768 断点时按 `resolveViewMode` 重新计算，但不覆盖用户显式选择。
- 工具条渲染三个 `aria-pressed` 按钮；切换时写 `localStorage`。
- `viewMode === '3d'` 且非聚合时渲染 `Graph3DView`；`2d` 保持原 SVG；`list` 保持原列表。
- 给 2D 容器加 `data-testid="graph2d-canvas"`，页面根节点加 `data-view-mode`。
- 3D 与 2D 共用 `expand()`、`selected`、`drawerTab`、详情抽屉；切换视图不重新请求数据。
- 聚合（>400）时继续渲染现有按类型簇卡片；3D 按钮禁用并给出提示。

- [ ] **Step 4: 更新现有 E2E 与新增 3D E2E**

`graph.spec.ts` 在桌面用例开头点击「平面」。`graph3d.spec.ts` 覆盖：

```ts
test('desktop defaults to 3d and persists plane view', async ({ page }) => {
  await page.goto('/graph');
  await expect(page.getByRole('button', { name: '3D', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('graph3d-view')).toBeVisible();
  await page.getByRole('button', { name: '平面', exact: true }).click();
  await expect(page.getByTestId('graph2d-canvas')).toBeVisible();
  await page.reload();
  await expect(page.getByTestId('graph2d-canvas')).toBeVisible();
});
```

- [ ] **Step 5: 运行测试**

Run: `pnpm --filter @kos/web test -- src/pages/graph/GraphPage.test.tsx`

Expected: PASS。

Run: `pnpm --filter @kos/web exec playwright test e2e/graph.spec.ts e2e/graph3d.spec.ts`

Expected: PASS（若本机无 WebGL，3D 用例先 `test.skip`，降级用例仍须通过）。

- [ ] **Step 6: 提交**

```bash
git add apps/web/src/pages/graph/GraphPage.tsx apps/web/src/pages/graph/GraphPage.test.tsx \
  apps/web/e2e/graph.spec.ts apps/web/e2e/graph3d.spec.ts
git commit -m "feat(graph): switch graph page to 3d by default"
```

---

### Task 5: 打通 3D 交互（相机、悬停、搜索、重置、抽屉）

**Files:**
- Modify: `apps/web/src/pages/graph/Graph3DView.tsx`
- Modify: `apps/web/src/pages/graph/GraphPage.tsx`
- Test: `apps/web/src/pages/graph/Graph3DView.test.tsx`
- Test: `apps/web/e2e/graph3d.spec.ts`

**Interfaces:**
- Produces:
  - `Graph3DViewHandle.focusNode(id)`：选中并飞行到节点。
  - `Graph3DViewHandle.resetView()`：回到默认机位。
  - 页面根节点 `data-camera="x,y,z"` 与 `data-engine="running|stopped"`，供 E2E 断言相机确实变化。
  - 搜索下拉选中实体时调用 `focusNode`，再调用现有 `expand`。

- [ ] **Step 1: 写失败测试**

在 `Graph3DView.test.tsx` 中把 mock 的相机方法提取为 hoisted spy，并让 mock 额外渲染一个 `hover-b` 按钮调用 `props.onNodeHover(props.graphData.nodes[1])`：

```tsx
const graphSpies = vi.hoisted(() => ({
  cameraPosition: vi.fn(),
  d3ReheatSimulation: vi.fn(),
  pauseAnimation: vi.fn(),
}));
vi.mock('react-force-graph-3d', async () => {
  const React = await import('react');
  return {
    default: React.forwardRef(function Mock(props: any, ref: any) {
      React.useImperativeHandle(ref, () => graphSpies);
      return (
        <>
          <button data-testid="mock-force-graph" onClick={() => props.onNodeClick(props.graphData.nodes[0])}>
            mock
          </button>
          <button onMouseEnter={() => props.onNodeHover(props.graphData.nodes[1])}>hover-b</button>
        </>
      );
    }),
  };
});

it('focusNode 调用相机，hover 更新高亮状态', async () => {
  const ref = createRef<Graph3DViewHandle>();
  render(<Graph3DView ref={ref} nodes={nodes} edges={edges} selected={null} onSelect={vi.fn()} onExpand={vi.fn()} />);
  await screen.findByTestId('mock-force-graph');

  act(() => ref.current?.focusNode('a'));
  expect(graphSpies.cameraPosition).toHaveBeenCalled();

  await userEvent.hover(screen.getByText('hover-b'));
  expect(screen.getByTestId('graph3d-view')).toHaveAttribute('data-hovered', 'b');
});
```

E2E 增加（复用 `graph.spec.ts` 的图谱数据准备，避免依赖开发库残留）：

```ts
test('search focuses a node and reset restores camera', async ({ page }) => {
  await page.goto('/graph');
  const before = await page.locator('[data-camera]').getAttribute('data-camera');
  await page.getByLabel('搜索实体').fill('ACV3');
  await page.getByRole('button', { name: /ACV3/ }).first().click();
  await expect(page.locator('[data-camera]')).not.toHaveAttribute('data-camera', before ?? '');
  await page.getByRole('button', { name: '重置视图' }).click();
  await expect(page.locator('[data-engine]')).toHaveAttribute('data-engine', 'stopped');
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm --filter @kos/web test -- src/pages/graph/Graph3DView.test.tsx`

Expected: FAIL（`onCameraChange` 未触发）。

- [ ] **Step 3: 实现交互**

- `Graph3DView` 增加 `hovered` 状态；`onNodeHover` 计算 `neighborsOf`，邻接高亮：邻居节点放大 1.2、非邻居降低不透明度、边显示类型标签；容器同步写入 `data-hovered=<id>`。
- 相机控制回调：`onControlEnd`（若组件支持）或渲染循环采样，把相机位置通过 `onCameraChange` 上报；页面把值写到 `data-camera`。
- 搜索：现有搜索结果按钮点击后，先 `ref.focusNode(entity.id)`，再 `void expand(node)`。
- 双击节点：`onNodeDoubleClick` → `focusNode + expand`；双击空白 → `resetView`。
- `resetView` 恢复到初始相机（`{x:0,y:0,z:600}`，视实现而定）。
- 节点拖拽保持 `enableNodeDrag={false}`；拖拽开关作为可选按钮（默认关闭），开启后只调用一次 `d3ReheatSimulation`。
- 详情抽屉保持现有实现，3D 点击与 2D 点击走同一个 `expand`。

- [ ] **Step 4: 运行测试**

Run: `pnpm --filter @kos/web test -- src/pages/graph/Graph3DView.test.tsx`

Expected: PASS。

Run: `pnpm --filter @kos/web exec playwright test e2e/graph3d.spec.ts`

Expected: PASS（WebGL 不可用时 skip）。

- [ ] **Step 5: 提交**

```bash
git add apps/web/src/pages/graph/Graph3DView.tsx apps/web/src/pages/graph/GraphPage.tsx \
  apps/web/src/pages/graph/Graph3DView.test.tsx apps/web/e2e/graph3d.spec.ts
git commit -m "feat(graph): wire 3d camera, hover, search and reset"
```

---

### Task 6: 无障碍隐藏节点列表与键盘操作

**Files:**
- Create: `apps/web/src/pages/graph/GraphA11yList.tsx`
- Test: `apps/web/src/pages/graph/GraphA11yList.test.tsx`
- Modify: `apps/web/src/pages/graph/GraphPage.tsx`
- Modify: `apps/web/e2e/graph3d.spec.ts`

**Interfaces:**
- Produces:
  - `interface GraphA11yListProps { nodes: GraphNode[]; selected: string | null; onSelect: (id: string) => void; onExpand: (node: GraphNode) => void }`
  - 列表固定 `aria-label="图谱节点列表"`，每项按钮名称为 `节点 ${name}`。

- [ ] **Step 1: 写失败测试**

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { GraphA11yList } from './GraphA11yList.js';

it('提供与画布一致的选中与展开动作', async () => {
  const onSelect = vi.fn();
  const onExpand = vi.fn();
  const node = { id: 'a', name: 'RRF', type: 'concept', aliases: [], mentionCount: 1, confidence: 0.8, mergedIntoId: null };
  render(<GraphA11yList nodes={[node]} selected={null} onSelect={onSelect} onExpand={onExpand} />);
  await userEvent.click(screen.getByRole('button', { name: '节点 RRF' }));
  expect(onSelect).toHaveBeenCalledWith('a');
  expect(onExpand).toHaveBeenCalledWith(node);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm --filter @kos/web test -- src/pages/graph/GraphA11yList.test.tsx`

Expected: FAIL，组件不存在。

- [ ] **Step 3: 实现并接入**

- 使用 `<ul className="sr-only" aria-label="图谱节点列表">`，按钮在 3D/2D/列表三种视图下都渲染（列表视图中额外可见列表已有，隐藏列表仍保留键盘入口）。
- 按钮 `onClick` 同时 `onSelect` 与 `onExpand`。
- `GraphPage` 在 3D 与 2D 模式下渲染隐藏列表；3D 下按 `Tab` 可进入，`Enter` 触发原生按钮。

- [ ] **Step 4: E2E 覆盖**

```ts
test('hidden node list expands a node without duplicate requests', async ({ page }) => {
  let neighborRequests = 0;
  page.on('request', (request) => {
    if (request.url().includes('/neighbors')) neighborRequests += 1;
  });
  await page.goto('/graph');
  const list = page.getByRole('list', { name: '图谱节点列表' });
  const first = list.getByRole('button').first();
  await first.click();
  await expect(page.getByRole('button', { name: '关闭' })).toBeVisible();
  const afterFirst = neighborRequests;
  await first.click();
  expect(neighborRequests).toBe(afterFirst);
});
```

- [ ] **Step 5: 运行测试**

Run: `pnpm --filter @kos/web test -- src/pages/graph/GraphA11yList.test.tsx`

Run: `pnpm --filter @kos/web exec playwright test e2e/graph3d.spec.ts`

Expected: PASS。

- [ ] **Step 6: 提交**

```bash
git add apps/web/src/pages/graph/GraphA11yList.tsx apps/web/src/pages/graph/GraphA11yList.test.tsx \
  apps/web/src/pages/graph/GraphPage.tsx apps/web/e2e/graph3d.spec.ts
git commit -m "feat(graph): add accessible node list for 3d view"
```

---

### Task 7: WebGL 降级、上下文丢失与慢设备提示

**Files:**
- Modify: `apps/web/src/lib/graph-view.ts`
- Test: `apps/web/src/lib/graph-view.test.ts`
- Modify: `apps/web/src/pages/graph/Graph3DView.tsx`
- Modify: `apps/web/src/pages/graph/GraphPage.tsx`
- Modify: `apps/web/e2e/graph3d.spec.ts`

**Interfaces:**
- Produces: 页面根据 `onContextLost` 切到 `2d` 并显示提示条；慢设备提示文案为「3D 视图可能较慢，可切到平面视图」。
- Consumes: `shouldOfferFallback(firstFrameMs, fps)`。

- [ ] **Step 1: 写失败测试**

```ts
// graph-view.test.ts 追加
it('首帧 >4s 或 5s 平均 <20fps 时才提示', () => {
  expect(shouldOfferFallback(4001, 60)).toBe(true);
  expect(shouldOfferFallback(1200, 19)).toBe(true);
  expect(shouldOfferFallback(1200, 20)).toBe(false);
});
```

E2E 增加无 WebGL 场景：

```ts
test('falls back to plane view when WebGL is unavailable', async ({ page }) => {
  await page.addInitScript(() => {
    HTMLCanvasElement.prototype.getContext = () => null;
  });
  await page.goto('/graph');
  await expect(page.getByTestId('graph2d-canvas')).toBeVisible();
  await expect(page.getByText('当前设备不支持 3D')).toBeVisible();
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm --filter @kos/web test -- src/lib/graph-view.test.ts`

Expected: FAIL（阈值或函数未实现）。

- [ ] **Step 3: 实现**

- WebGL 不可用：初始化时 `supportsWebGL()` 为 false → 直接 `viewMode='2d'`，显示提示条。
- 上下文丢失：在 3D 容器监听 `webglcontextlost`，调用 `onContextLost`；页面切 2D 并提示。
- 慢设备：`Graph3DView` 记录首帧时间与 5 秒平均帧率，调用 `onSlow`；页面显示提示条与「切到平面视图」按钮，不强制切换。
- 提示条使用现有 `Badge`/`card` 样式，不新增颜色令牌。

- [ ] **Step 4: 运行测试**

Run: `pnpm --filter @kos/web test -- src/lib/graph-view.test.ts`

Run: `pnpm --filter @kos/web exec playwright test e2e/graph3d.spec.ts`

Expected: PASS；无 WebGL 用例必须实际走到 2D。

- [ ] **Step 5: 提交**

```bash
git add apps/web/src/lib/graph-view.ts apps/web/src/lib/graph-view.test.ts \
  apps/web/src/pages/graph/Graph3DView.tsx apps/web/src/pages/graph/GraphPage.tsx \
  apps/web/e2e/graph3d.spec.ts
git commit -m "feat(graph): fall back gracefully when webgl is unavailable"
```

---

### Task 8: 验收、性能报告与全量门禁

**Files:**
- Create: `docs/ACCEPTANCE_V2.1.md`
- Create: `docs/GRAPH_3D_PERFORMANCE_REPORT.md`
- Modify: `docs/PROGRESS.md`
- Modify: `docs/README.md`
- Modify: `docs/IMPLEMENTATION_PLAN.md`（12.2 增加 V2.1 里程碑）

**Interfaces:**
- Consumes: 前 7 个任务的实现与 E2E。
- Produces: 10 条 AC-V2.1 记录；首帧、400 节点帧率、懒加载 chunk 大小、WebGL 降级记录。

- [ ] **Step 1: 运行完整门禁**

```bash
pnpm lint
pnpm typecheck
pnpm build
pnpm --filter @kos/web test
pnpm --filter @kos/web exec playwright test
```

Expected: 全部通过。

- [ ] **Step 2: 采集性能数据**

- 入口 20 节点：记录 3 次首帧中位数。
- 400 节点：用脚本生成临时图谱数据或 E2E 注入，记录 5 秒平均 fps。
- 构建产物：记录图谱路由懒加载 chunk 的 gzip 大小（≤450KB）。
- 无 WebGL：记录切到 2D 的耗时（≤1s）。

- [ ] **Step 3: 写验收与报告**

`ACCEPTANCE_V2.1.md` 按 AC-V2.1-1..10 逐条填写证据；`GRAPH_3D_PERFORMANCE_REPORT.md` 写清测试环境、方法、数值与未达标项。`PROGRESS.md` 增加 V2.1 看板与门禁行；`README.md` 文档索引增加两份新文档；`IMPLEMENTATION_PLAN.md` 12.2 后增加 `12.2.1 V2.1 3D 图谱（1 周）`。

- [ ] **Step 4: 提交**

```bash
git add docs/ACCEPTANCE_V2.1.md docs/GRAPH_3D_PERFORMANCE_REPORT.md \
  docs/PROGRESS.md docs/README.md docs/IMPLEMENTATION_PLAN.md
git commit -m "docs(graph): record v2.1 3d acceptance and performance"
```

---

## 验收对照

| PRD 要求 | 任务 |
| --- | --- |
| 桌面默认 3D、三态切换、持久化 | Task 1、Task 4 |
| 旋转/缩放/平移/重置 | Task 3、Task 5 |
| 点击展开、详情抽屉、去重 | Task 4、Task 5、Task 6 |
| 悬停高亮与边类型 | Task 5 |
| 搜索定位 | Task 5 |
| 几何体/线型/冻结布局 | Task 2、Task 3 |
| >400 聚合、500/2000 上限 | Task 2、Task 4 |
| WebGL 降级与慢设备提示 | Task 7 |
| 键盘与隐藏列表 | Task 6 |
| 懒加载体积与首帧 | Task 3、Task 8 |

## 不在本计划

- 自动层级脑图、VR/AR、3D 场景导出。
- 后端图谱查询优化、实体抽取质量改进。
- 将 3D 视图嵌入问答页或 Wiki 页。
