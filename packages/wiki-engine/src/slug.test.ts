import { describe, expect, it } from 'vitest';
import { slugify } from './slug.js';

describe('slugify', () => {
  it('保留中文并转换空格与标点', () => {
    expect(slugify('混合检索（RAG）')).toBe('混合检索-rag');
    expect(slugify('Hybrid Retrieval')).toBe('hybrid-retrieval');
    expect(slugify('  RRF / 倒数排名融合  ')).toBe('rrf-倒数排名融合');
  });

  it('相同输入生成稳定结果', () => {
    expect(slugify('Qdrant')).toBe(slugify('qdrant'));
  });

  it('无有效字符时回退为稳定哈希', () => {
    const first = slugify('（）');
    expect(first).toMatch(/^page-[0-9a-f]{8}$/);
    expect(first).toBe(slugify('（）'));
  });
});
