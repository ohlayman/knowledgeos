import { createRef } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { GraphEdge, GraphNode } from '../../features/schemas.js';
import { ThemeProvider } from '../../lib/theme.js';
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
});
