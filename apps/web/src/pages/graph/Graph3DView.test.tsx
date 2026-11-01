import { act, createRef } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { GraphEdge, GraphNode } from '../../features/schemas.js';
import { ThemeProvider } from '../../lib/theme.js';
import { Graph3DView, type Graph3DViewHandle } from './Graph3DView.js';

const graphSpies = vi.hoisted(() => ({
  cameraPosition: vi.fn(),
  d3ReheatSimulation: vi.fn(),
  pauseAnimation: vi.fn(),
  refresh: vi.fn(),
}));

interface MockProps {
  graphData: { nodes: Array<{ id: string }> };
  cooldownTicks?: number;
  controlType?: string;
  enableNodeDrag?: boolean;
  onNodeClick?: (node: { id: string }) => void;
  onNodeHover?: (node: { id: string } | null) => void;
}

vi.mock('react-force-graph-3d', async () => {
  const React = await import('react');
  return {
    default: React.forwardRef(function Mock(props: MockProps, ref: React.ForwardedRef<unknown>) {
      React.useImperativeHandle(ref, () => graphSpies);
      const first = props.graphData.nodes[0];
      const second = props.graphData.nodes[1] ?? first;
      return (
        <>
          <button
            data-testid="mock-force-graph"
            data-nodes={props.graphData.nodes.length}
            data-cooldown={String(props.cooldownTicks)}
            data-control={String(props.controlType)}
            data-drag={String(props.enableNodeDrag)}
            onClick={() => first && props.onNodeClick?.(first)}
          >
            mock
          </button>
          <button onMouseEnter={() => second && props.onNodeHover?.(second)}>hover-b</button>
        </>
      );
    }),
  };
});

const nodes: GraphNode[] = [
  {
    id: 'a',
    name: 'A',
    type: 'concept',
    aliases: [],
    mentionCount: 1,
    confidence: 0.8,
    mergedIntoId: null,
  },
  {
    id: 'b',
    name: 'B',
    type: 'technology',
    aliases: [],
    mentionCount: 1,
    confidence: 0.8,
    mergedIntoId: null,
  },
];

const edges: GraphEdge[] = [
  {
    id: 'e1',
    fromId: 'a',
    toId: 'b',
    type: 'USES',
    confidence: 0.9,
    evidenceChunkIds: [],
    status: 'active',
    origin: 'model',
    direction: 'out',
  },
];

function renderView(ref: React.RefObject<Graph3DViewHandle | null>) {
  return render(
    <ThemeProvider>
      <Graph3DView
        ref={ref}
        nodes={nodes}
        edges={edges}
        selected={null}
        onSelect={vi.fn()}
        onExpand={vi.fn()}
      />
    </ThemeProvider>,
  );
}

describe('Graph3DView', () => {
  it('传入冻结配置并转发节点点击', async () => {
    const onSelect = vi.fn();
    const onExpand = vi.fn();
    const ref = createRef<Graph3DViewHandle>();

    render(
      <ThemeProvider>
        <Graph3DView
          ref={ref}
          nodes={nodes}
          edges={edges}
          selected={null}
          onSelect={onSelect}
          onExpand={onExpand}
        />
      </ThemeProvider>,
    );

    const graph = await screen.findByTestId('mock-force-graph');
    expect(graph).toHaveAttribute('data-nodes', '2');
    expect(graph).toHaveAttribute('data-cooldown', '120');
    expect(graph).toHaveAttribute('data-control', 'orbit');
    expect(graph).toHaveAttribute('data-drag', 'false');

    await userEvent.click(graph);
    expect(onSelect).toHaveBeenCalledWith('a');
    expect(onExpand).toHaveBeenCalledWith(nodes[0]);
  });

  it('focusNode 调用相机，hover 更新高亮状态', async () => {
    const ref = createRef<Graph3DViewHandle>();
    renderView(ref);
    await screen.findByTestId('mock-force-graph');

    act(() => ref.current?.focusNode('a'));
    expect(graphSpies.cameraPosition).toHaveBeenCalled();

    await userEvent.hover(screen.getByText('hover-b'));
    expect(screen.getByTestId('graph3d-view')).toHaveAttribute('data-hovered', 'b');
  });
});
