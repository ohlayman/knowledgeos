import { describe, expect, it } from 'vitest';
import { normalizeEntityName } from './entity.js';

describe('normalizeEntityName', () => {
  it('统一大小写、空白与标点', () => {
    expect(normalizeEntityName('  Hybrid   Retrieval! ')).toBe('hybrid retrieval');
    expect(normalizeEntityName('混合检索（RAG）')).toBe('混合检索 rag');
  });

  it('去掉英文复数后缀', () => {
    expect(normalizeEntityName('Embeddings')).toBe('embedding');
    expect(normalizeEntityName('APIs')).toBe('api');
    expect(normalizeEntityName('Analysis')).toBe('analysis');
  });

  it('保留短词与中文原文', () => {
    expect(normalizeEntityName('RAG')).toBe('rag');
    expect(normalizeEntityName('知识图谱')).toBe('知识图谱');
  });

  it('空字符串返回空串', () => {
    expect(normalizeEntityName('   ')).toBe('');
  });
});
