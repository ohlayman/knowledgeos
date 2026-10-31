import { describe, expect, it } from 'vitest';
import { buildTsQuery, rrf } from './rrf.js';

describe('rrf', () => {
  it('按倒数排名融合多路结果', () => {
    const fused = rrf(
      [
        [{ id: 'c3' }, { id: 'c1' }, { id: 'c9' }],
        [{ id: 'c1' }, { id: 'c3' }],
      ],
      60,
    );

    expect(fused[0]?.id).toBe('c1');
    expect(fused[1]?.id).toBe('c3');
    expect(fused[0]?.score).toBeCloseTo(1 / 62 + 1 / 61, 6);
    expect(fused[2]?.id).toBe('c9');
  });

  it('同分时按最高单路排名再按 ID 排序', () => {
    const fused = rrf([
      [{ id: 'b' }, { id: 'a' }],
      [{ id: 'a' }, { id: 'b' }],
    ]);

    expect(fused.map((item) => item.id)).toEqual(['a', 'b']);
  });

  it('空输入返回空数组', () => {
    expect(rrf([])).toEqual([]);
  });
});

describe('buildTsQuery', () => {
  it('中文生成 bigram 的 AND 查询', () => {
    expect(buildTsQuery('混合检索')).toBe('混合 & 合检 & 检索');
  });

  it('英文小写并按空白切词', () => {
    expect(buildTsQuery('Hybrid Retrieval')).toBe('hybrid & retrieval');
  });

  it('token 过多时改为 4 个一组的 OR 分组', () => {
    const query = buildTsQuery('一一二二三三四四五五六六七七八八九九十十');
    const groups = query.split(' | ');

    expect(groups.length).toBeGreaterThan(1);
    expect(groups[0]!.split(' & ')).toHaveLength(4);
  });

  it('空问题返回空字符串', () => {
    expect(buildTsQuery('   ')).toBe('');
  });
});
