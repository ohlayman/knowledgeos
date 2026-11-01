import { describe, expect, it } from 'vitest';
import { shouldAggregate, shouldHideLabels } from './graph.js';

describe('graph 规模规则', () => {
  it('超过 400 节点自动聚合', () => {
    expect(shouldAggregate(400)).toBe(false);
    expect(shouldAggregate(401)).toBe(true);
  });

  it('超过 150 节点隐藏标签', () => {
    expect(shouldHideLabels(150)).toBe(false);
    expect(shouldHideLabels(151)).toBe(true);
  });
});
