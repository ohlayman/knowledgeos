import { createRef } from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { GraphEdge, GraphNode } from '../../features/schemas.js';
import { Graph2DView, type Graph2DViewHandle } from './Graph2DView.js';

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

function view(ref: React.RefObject<Graph2DViewHandle | null>) {
  return (
    <Graph2DView
      ref={ref}
      nodes={nodes}
      edges={edges}
      selected={null}
      expanded={new Set()}
      onSelect={vi.fn()}
      onExpand={vi.fn()}
      onBackgroundDoubleClick={vi.fn()}
    />
  );
}

describe('Graph2DView', () => {
  it('shows the relation type when hovering an edge', async () => {
    render(view(createRef<Graph2DViewHandle>()));

    await userEvent.hover(screen.getByTestId('edge-hit-e1'));
    expect(screen.getByTestId('edge-label-e1')).toHaveTextContent('USES');
  });

  it('marks newly added nodes as entering', () => {
    const { rerender } = render(
      <Graph2DView
        nodes={[nodes[0]!]}
        edges={[]}
        selected={null}
        expanded={new Set()}
        onSelect={vi.fn()}
        onExpand={vi.fn()}
        onBackgroundDoubleClick={vi.fn()}
      />,
    );

    rerender(
      <Graph2DView
        nodes={nodes}
        edges={edges}
        selected={null}
        expanded={new Set()}
        onSelect={vi.fn()}
        onExpand={vi.fn()}
        onBackgroundDoubleClick={vi.fn()}
      />,
    );

    expect(screen.getByTestId('node-b')).toHaveAttribute('data-entering', 'true');
  });

  it('shows a hint when the selected node has no relations', () => {
    render(
      <Graph2DView
        nodes={nodes}
        edges={[]}
        selected="a"
        expanded={new Set()}
        onSelect={vi.fn()}
        onExpand={vi.fn()}
        onBackgroundDoubleClick={vi.fn()}
      />,
    );

    expect(screen.getByTestId('graph2d-no-neighbor')).toHaveTextContent('该概念暂未建立关系');
  });

  it('renders a dot grid and node type icon', () => {
    render(view(createRef<Graph2DViewHandle>()));

    expect(document.querySelector('#dot-grid')).not.toBeNull();
    expect(
      within(screen.getByTestId('graph2d-canvas')).getByTestId('node-icon-technology'),
    ).toBeInTheDocument();
  });

  it('zooms with buttons and resets the viewport', async () => {
    const ref = createRef<Graph2DViewHandle>();
    render(view(ref));

    const canvas = screen.getByTestId('graph2d-canvas');
    expect(canvas).toHaveAttribute('data-viewport', '0,0,1');

    await userEvent.click(screen.getByRole('button', { name: '放大' }));
    expect(canvas.getAttribute('data-viewport')).not.toBe('0,0,1');

    await userEvent.click(screen.getByRole('button', { name: '重置视图' }));
    expect(canvas).toHaveAttribute('data-viewport', '0,0,1');
  });
});
