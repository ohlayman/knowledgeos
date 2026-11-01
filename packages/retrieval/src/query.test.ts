import { describe, expect, it } from 'vitest';
import { detectQuestionType, extractEntities, RuleBasedQueryUnderstanding } from './query.js';

describe('detectQuestionType', () => {
  it('识别对比型问题', () => {
    expect(detectQuestionType('Redis 和 Qdrant 有什么区别')).toBe('comparison');
    expect(detectQuestionType('skill vs MCP server')).toBe('comparison');
  });

  it('识别关系型问题', () => {
    expect(detectQuestionType('Qdrant 和 稀疏向量 是什么关系')).toBe('relation');
  });

  it('识别操作型问题', () => {
    expect(detectQuestionType('如何配置 Qdrant 集合')).toBe('procedure');
  });

  it('识别事实型与开放型', () => {
    expect(detectQuestionType('RRF 的 k 值是什么')).toBe('fact');
    expect(detectQuestionType('混合检索的取舍')).toBe('open');
  });
});

describe('extractEntities', () => {
  it('按连接词拆分两个实体', () => {
    expect(extractEntities('Redis 和 Qdrant 有什么区别')).toEqual(['Redis', 'Qdrant']);
  });

  it('关系型问题去掉实体后的“是/什么关系”', () => {
    expect(extractEntities('Qdrant 和 稀疏向量 是什么关系')).toEqual(['Qdrant', '稀疏向量']);
  });

  it('优先使用引号内术语', () => {
    expect(extractEntities('「向量召回」与「关键词召回」的差异')).toEqual([
      '向量召回',
      '关键词召回',
    ]);
  });
});

describe('RuleBasedQueryUnderstanding', () => {
  it('原样保留问题并给出实体与类型', async () => {
    const result = await new RuleBasedQueryUnderstanding().understand('Redis 和 Qdrant 有什么区别');

    expect(result.rewrittenQuery).toBe('Redis 和 Qdrant 有什么区别');
    expect(result.questionType).toBe('comparison');
    expect(result.entities).toEqual(['Redis', 'Qdrant']);
    expect(result.keywordHints).toEqual(['Redis', 'Qdrant']);
  });

  it('非对比问题不抽取实体', async () => {
    const result = await new RuleBasedQueryUnderstanding().understand('如何配置 Qdrant');

    expect(result.questionType).toBe('procedure');
    expect(result.entities).toEqual([]);
  });
});
