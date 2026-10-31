import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { CitationText, DegradedNote, MetricCard } from './business.js';

describe('CitationText', () => {
  it('把角标渲染为可点击按钮', async () => {
    const onSelect = vi.fn();
    render(
      <CitationText
        text="混合检索同时使用两路召回 [1]。"
        citations={[
          {
            ordinal: 1,
            chunkId: 'c1',
            documentId: 'd1',
            versionId: 'v1',
            quote: '混合检索',
            valid: true,
          },
        ]}
        onSelect={onSelect}
      />,
    );

    const button = screen.getByRole('button', { name: '引用 1' });
    await userEvent.click(button);

    expect(onSelect).toHaveBeenCalledWith(1);
    expect(button).toHaveClass('cite');
  });

  it('无效引用带警示样式', () => {
    render(
      <CitationText
        text="结论 [2]"
        citations={[
          {
            ordinal: 2,
            chunkId: 'c2',
            documentId: 'd2',
            versionId: 'v2',
            quote: '',
            valid: false,
          },
        ]}
      />,
    );

    expect(screen.getByRole('button', { name: '引用 2（不可验证）' })).toHaveClass('invalid');
  });
});

describe('DegradedNote', () => {
  it('向量不可用时标注降级原因', () => {
    render(<DegradedNote degraded={['vector_unavailable']} />);
    expect(screen.getByText('降级：vector_unavailable')).toBeInTheDocument();
  });

  it('没有降级时不渲染', () => {
    const { container } = render(<DegradedNote degraded={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe('MetricCard', () => {
  it('可链接到筛选页面', () => {
    render(
      <MemoryRouter>
        <MetricCard label="文档" value={3} to="/library?status=ready" />
      </MemoryRouter>,
    );

    const link = screen.getByRole('link');
    expect(link).toHaveAttribute('href', '/library?status=ready');
    expect(screen.getByText('文档')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
  });
});
