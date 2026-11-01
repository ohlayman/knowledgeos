import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { NodeIcon } from './graph-node-icon.js';

describe('NodeIcon', () => {
  it('renders a distinct icon per node type', () => {
    for (const type of ['concept', 'technology', 'project', 'agent', 'protocol']) {
      const { unmount } = render(<NodeIcon type={type} />);
      expect(screen.getByTestId(`node-icon-${type}`)).toBeInTheDocument();
      unmount();
    }
  });

  it('falls back to the concept icon for unknown types', () => {
    render(<NodeIcon type="unknown" />);
    expect(screen.getByTestId('node-icon-unknown')).toBeInTheDocument();
  });
});
