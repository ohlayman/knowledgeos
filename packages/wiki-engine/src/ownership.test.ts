import { describe, expect, it } from 'vitest';
import { judgeOwnership, type PageCandidate } from './ownership.js';

const page = (overrides: Partial<PageCandidate> = {}): PageCandidate => ({
  id: 'page-1',
  slug: 'hybrid-retrieval',
  title: '混合检索',
  aliases: ['Hybrid Retrieval'],
  type: 'concept',
  evidenceChunkIds: ['chunk-1'],
  ...overrides,
});

const entity = (overrides: Record<string, unknown> = {}) => ({
  name: '混合检索',
  type: 'concept' as const,
  sourceChunkIds: ['chunk-1'],
  ...overrides,
});

describe('judgeOwnership', () => {
  it('标题精确匹配直接归属', async () => {
    const decision = await judgeOwnership({
      entity: entity(),
      pages: [page()],
      similarity: async () => 0,
    });

    expect(decision.kind).toBe('existing');
    expect(decision.level).toBe('exact');
    expect(decision.pageId).toBe('page-1');
  });

  it('别名精确匹配直接归属', async () => {
    const decision = await judgeOwnership({
      entity: entity({ name: 'Hybrid Retrieval' }),
      pages: [page()],
      similarity: async () => 0,
    });

    expect(decision.level).toBe('exact');
  });

  it('近似拼写 + 类型一致 + 共享来源才结构匹配', async () => {
    const typo = await judgeOwnership({
      entity: entity({ name: '混合檢索' }),
      pages: [page()],
      similarity: async () => 0,
    });
    expect(typo.level).toBe('structure');
    expect(typo.kind).toBe('existing');

    const noShared = await judgeOwnership({
      entity: entity({ name: '混合檢索', sourceChunkIds: ['other'] }),
      pages: [page()],
      similarity: async () => 0,
    });
    expect(noShared.kind).toBe('new');
  });

  it('类型不一致时语义相似也不归属', async () => {
    const decision = await judgeOwnership({
      entity: entity({ name: 'Qdrant', type: 'technology' }),
      pages: [page({ title: '向量数据库', aliases: [], evidenceChunkIds: ['chunk-1'] })],
      similarity: async () => 0.95,
    });

    expect(decision.kind).toBe('new');
  });

  it('语义相似 + 共享来源 + 类型一致时归属', async () => {
    const decision = await judgeOwnership({
      entity: entity({ name: '混合式检索' }),
      pages: [page({ title: '混合检索方法' })],
      similarity: async () => 0.9,
    });

    expect(decision.kind).toBe('existing');
    expect(decision.level).toBe('semantic');
  });

  it('包含关系的近似概念不自动归属，只给合并建议', async () => {
    const decision = await judgeOwnership({
      entity: entity({ name: 'GraphRAG' }),
      pages: [page({ title: 'RAG', aliases: [] })],
      similarity: async () => 0.93,
    });

    expect(decision.kind).toBe('merge_suggestion');
    expect(decision.pageId).toBe('page-1');
  });

  it('没有任何命中时新建页面', async () => {
    const decision = await judgeOwnership({
      entity: entity({ name: '全新概念', sourceChunkIds: ['chunk-9'] }),
      pages: [page()],
      similarity: async () => 0.2,
    });

    expect(decision.kind).toBe('new');
    expect(decision.level).toBe('none');
  });
});
