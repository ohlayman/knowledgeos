import { forwardRef } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GRAPH_VIEW_STORAGE_KEY } from '../../lib/graph-view.js';
import { GraphPage } from './GraphPage.js';

const node = {
  id: 'a',
  name: 'RRF',
  type: 'concept',
  aliases: [],
  mentionCount: 2,
  confidence: 0.8,
  mergedIntoId: null,
};

vi.mock('../../features/hooks.js', () => ({
  useGraphEntry: () => ({
    data: [{ node, degree: 1 }],
    isLoading: false,
    isError: false,
  }),
  useWikiEntities: () => ({ data: [] }),
  useEntityMentions: () => ({ data: [] }),
  useGraphPending: () => ({ data: [] }),
  useConfirmRelation: () => ({ mutate: vi.fn(), isPending: false }),
}));

vi.mock('../../lib/webgl.js', () => ({ supportsWebGL: () => true }));

vi.mock('../../lib/api-client.js', () => ({
  apiFetch: vi.fn().mockResolvedValue([]),
  errorMessage: (error: unknown) => String(error),
}));

vi.mock('./Graph3DView.js', () => ({
  Graph3DView: forwardRef(function MockGraph3D() {
    return <div data-testid="graph3d-view" />;
  }),
}));

beforeEach(() => {
  localStorage.clear();
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1440 });
});

describe('GraphPage 视图切换', () => {
  it('桌面默认 3D，切到平面后写入偏好', async () => {
    render(
      <MemoryRouter>
        <GraphPage />
      </MemoryRouter>,
    );

    expect(await screen.findByTestId('graph3d-view')).toBeVisible();
    const mode3d = screen.getByRole('button', { name: '3D' });
    expect(mode3d).toHaveAttribute('aria-pressed', 'true');

    await userEvent.click(screen.getByRole('button', { name: '平面' }));

    await waitFor(() => expect(screen.getByTestId('graph2d-canvas')).toBeVisible());
    expect(localStorage.getItem(GRAPH_VIEW_STORAGE_KEY)).toBe('2d');
  });

  it('窄屏默认列表', async () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 });
    render(
      <MemoryRouter>
        <GraphPage />
      </MemoryRouter>,
    );

    await waitFor(() =>
      expect(screen.getByRole('button', { name: '列表' })).toHaveAttribute('aria-pressed', 'true'),
    );
    expect(screen.queryByTestId('graph3d-view')).not.toBeInTheDocument();
  });
});
