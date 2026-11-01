import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { GraphNode } from '../../features/schemas.js';
import { GraphA11yList } from './GraphA11yList.js';

const node: GraphNode = {
  id: 'a',
  name: 'RRF',
  type: 'concept',
  aliases: [],
  mentionCount: 1,
  confidence: 0.8,
  mergedIntoId: null,
};

describe('GraphA11yList', () => {
  it('提供与画布一致的选中与展开动作', async () => {
    const onSelect = vi.fn();
    const onExpand = vi.fn();

    render(
      <GraphA11yList nodes={[node]} selected={null} onSelect={onSelect} onExpand={onExpand} />,
    );

    await userEvent.click(screen.getByRole('button', { name: '节点 RRF' }));

    expect(onSelect).toHaveBeenCalledWith('a');
    expect(onExpand).toHaveBeenCalledWith(node);
  });

  it('标记当前选中节点', () => {
    render(<GraphA11yList nodes={[node]} selected="a" onSelect={vi.fn()} onExpand={vi.fn()} />);

    expect(screen.getByRole('button', { name: '节点 RRF' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });
});
