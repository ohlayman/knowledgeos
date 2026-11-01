import { describe, expect, it } from 'vitest';
import { extractWikiLinks } from './links.js';

describe('extractWikiLinks', () => {
  it('解析裸链接与带类型链接', () => {
    const links = extractWikiLinks('混合检索依赖 [[向量召回]]，并关联 [[RRF|USES]]。');
    expect(links).toHaveLength(2);
    expect(links[0]).toMatchObject({ targetSlug: '向量召回', relationType: null });
    expect(links[1]).toMatchObject({ targetSlug: 'RRF', relationType: 'USES' });
  });

  it('忽略重复链接与空链接', () => {
    const links = extractWikiLinks('[[A]] 与 [[A]] 以及 [[]]');
    expect(links).toHaveLength(1);
  });

  it('提取链接所在句作为上下文', () => {
    const links = extractWikiLinks('第一句。混合检索使用 [[RRF]] 融合。第三句。');
    expect(links[0]?.context).toBe('混合检索使用 [[RRF]] 融合。');
  });
});
