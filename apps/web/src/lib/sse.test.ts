import { describe, expect, it, vi } from 'vitest';
import { dispatchSseFrame } from './sse.js';

describe('dispatchSseFrame', () => {
  it('解析 delta 事件', () => {
    const onDelta = vi.fn();
    dispatchSseFrame('event: delta\ndata: {"text":"混合检索"}', { onDelta });

    expect(onDelta).toHaveBeenCalledWith('混合检索');
  });

  it('解析 citations 事件', () => {
    const onCitations = vi.fn();
    dispatchSseFrame(
      'event: citations\ndata: {"citations":[{"ordinal":1,"chunkId":"c1","valid":true}]}',
      { onCitations },
    );

    expect(onCitations).toHaveBeenCalledWith({
      citations: [{ ordinal: 1, chunkId: 'c1', valid: true }],
    });
  });

  it('忽略未知事件与损坏的 JSON', () => {
    const handlers = {
      onMeta: vi.fn(),
      onDelta: vi.fn(),
      onError: vi.fn(),
    };

    dispatchSseFrame('event: unknown\ndata: {"x":1}', handlers);
    dispatchSseFrame('event: delta\ndata: not-json', handlers);

    expect(handlers.onMeta).not.toHaveBeenCalled();
    expect(handlers.onDelta).not.toHaveBeenCalled();
    expect(handlers.onError).not.toHaveBeenCalled();
  });

  it('支持多行 data', () => {
    const onDelta = vi.fn();
    dispatchSseFrame('event: delta\ndata: {"text":"a"}\ndata: {"text":"b"}', { onDelta });

    expect(onDelta).not.toHaveBeenCalled();
  });
});
