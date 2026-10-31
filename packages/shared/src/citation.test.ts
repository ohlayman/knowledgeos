import { describe, expect, it } from 'vitest';
import { parseCitations, uniqueCitationOrdinals } from './citation.js';

describe('parseCitations', () => {
  it('按出现顺序解析角标', () => {
    expect(parseCitations('混合检索[1]优于单路[2]，再次强调[1]。')).toEqual([1, 2, 1]);
  });

  it('忽略非数字与零', () => {
    expect(parseCitations('引用[0]与[abc]以及[123]都不算。')).toEqual([]);
  });

  it('支持两位数角标', () => {
    expect(parseCitations('证据[12]与[3]')).toEqual([12, 3]);
  });

  it('没有角标返回空数组', () => {
    expect(parseCitations('没有任何引用')).toEqual([]);
  });
});

describe('uniqueCitationOrdinals', () => {
  it('去重并保持首次出现顺序', () => {
    expect(uniqueCitationOrdinals('a[2] b[1] c[2]')).toEqual([2, 1]);
  });
});
