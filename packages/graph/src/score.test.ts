import { describe, expect, it } from 'vitest';
import { scorePath, WEAK_RELATION_TYPES } from './score.js';

const edge = (
  type: string,
  confidence = 0.9,
  evidenceCount = 3,
): { type: string; confidence: number; evidenceChunkIds: string[] } => ({
  type,
  confidence,
  evidenceChunkIds: Array.from({ length: evidenceCount }, (_, index) => `chunk-${index}`),
});

describe('scorePath', () => {
  it('置信度乘积 × 来源质量均值 × 弱关系惩罚', () => {
    const result = scorePath([edge('USES', 0.9, 3), edge('PART_OF', 0.8, 3)]);

    expect(result.confidenceProduct).toBeCloseTo(0.72, 5);
    expect(result.sourceQuality).toBe(1);
    expect(result.weakPenalty).toBe(1);
    expect(result.score).toBeCloseTo(0.72, 5);
  });

  it('RELATED_TO 是弱关系，会被惩罚', () => {
    expect(WEAK_RELATION_TYPES.has('RELATED_TO')).toBe(true);
    const weak = scorePath([edge('RELATED_TO', 0.9, 3), edge('RELATED_TO', 0.9, 3)]);
    expect(weak.weakPenalty).toBeCloseTo(0.81, 5);
    expect(weak.score).toBeCloseTo(0.6561, 5);
  });

  it('三跳强关系可以优于两跳弱关系', () => {
    const weakTwo = scorePath([edge('RELATED_TO', 0.9, 3), edge('RELATED_TO', 0.9, 3)]);
    const strongThree = scorePath([
      edge('USES', 0.9, 3),
      edge('DEPENDS_ON', 0.9, 3),
      edge('IMPLEMENTS', 0.9, 3),
    ]);

    expect(strongThree.score).toBeGreaterThan(weakTwo.score);
  });

  it('证据很少时来源质量下降', () => {
    const thin = scorePath([edge('USES', 0.9, 1)]);
    expect(thin.sourceQuality).toBeCloseTo(1 / 3, 5);
  });

  it('空路径得分为 0', () => {
    expect(scorePath([]).score).toBe(0);
  });
});
