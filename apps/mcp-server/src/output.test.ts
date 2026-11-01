import { describe, expect, it } from 'vitest';
import { MCP_MAX_RESULT_BYTES } from '@kos/shared';
import { byteSize, fitToLimit, truncateText } from './output.js';

describe('fitToLimit', () => {
  it('leaves a small payload untouched', () => {
    const payload = { items: [{ chunkId: 'a', excerpt: 'RRF 融合' }], count: 1 };
    expect(fitToLimit(payload)).toEqual({ payload, truncated: false });
  });

  it('trims list items and reports the original count', () => {
    const payload = {
      items: Array.from({ length: 400 }, (_, index) => ({
        chunkId: `chunk-${index}`,
        documentTitle: `文档 ${index}`,
        excerpt: '每一段都足够长，用来逼近 32KB 的返回上限。'.repeat(20),
      })),
      count: 400,
    };

    const fitted = fitToLimit(payload);

    expect(fitted.truncated).toBe(true);
    expect(fitted.originalCount).toBe(400);
    expect(fitted.payload.truncated).toBe(true);
    expect(fitted.payload.originalCount).toBe(400);
    expect((fitted.payload.items as unknown[]).length).toBeLessThan(400);
    expect(byteSize(fitted.payload)).toBeLessThanOrEqual(MCP_MAX_RESULT_BYTES);
  });

  it('truncates oversized markdown when no list is present', () => {
    const payload = { title: '超长页面', markdown: '段落内容。'.repeat(10_000) };

    const fitted = fitToLimit(payload);

    expect(fitted.truncated).toBe(true);
    expect(String(fitted.payload.markdown)).toContain('已截断');
    expect(byteSize(fitted.payload)).toBeLessThanOrEqual(MCP_MAX_RESULT_BYTES);
  });
});

describe('truncateText', () => {
  it('keeps short text intact and marks long text', () => {
    expect(truncateText('短文本')).toBe('短文本');
    const long = truncateText('内容'.repeat(20_000), 1024);
    expect(long).toContain('已截断');
    expect(Buffer.byteLength(long, 'utf8')).toBeLessThan(1200);
  });
});
