import { describe, expect, it } from 'vitest';
import { buildSearchText } from './bigram.js';

describe('buildSearchText', () => {
  it('中文按相邻两字切分并保留单字', () => {
    expect(buildSearchText('知识库')).toBe('知识 识库');
    expect(buildSearchText('知识')).toBe('知识');
    expect(buildSearchText('库')).toBe('库');
  });

  it('英文与代码标识符小写并保留原词', () => {
    expect(buildSearchText('Hybrid Retrieval')).toBe('hybrid retrieval');
  });

  it('中英混排分别处理', () => {
    expect(buildSearchText('向量 recall 混合')).toBe('向量 recall 混合');
    expect(buildSearchText('混合检索 recall')).toBe('混合 合检 检索 recall');
  });

  it('标点作为分隔不产生跨段二元词', () => {
    expect(buildSearchText('甲，乙')).toBe('甲 乙');
  });
});
