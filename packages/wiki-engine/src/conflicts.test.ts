import { describe, expect, it } from 'vitest';
import { detectConflicts, type ConflictFact } from './conflicts.js';

const chunk = (suffix: string) => `00000000-0000-4000-8000-0000000000${suffix}`;

describe('detectConflicts', () => {
  it('标记数值冲突', () => {
    const conflicts = detectConflicts([
      { subject: 'RRF', predicate: '默认 k 值', value: '60', evidenceChunkId: chunk('01') },
      { subject: 'RRF', predicate: '默认 k 值', value: '30', evidenceChunkId: chunk('02') },
    ]);

    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]?.type).toBe('numeric');
    expect(conflicts[0]?.a.value).toBe('60');
    expect(conflicts[0]?.b.value).toBe('30');
  });

  it('标记否定冲突', () => {
    const conflicts = detectConflicts([
      { subject: 'Qdrant', predicate: '支持稀疏向量', value: '支持', evidenceChunkId: chunk('03') },
      {
        subject: 'Qdrant',
        predicate: '支持稀疏向量',
        value: '不支持',
        evidenceChunkId: chunk('04'),
      },
    ]);

    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]?.type).toBe('negation');
  });

  it('有时间差异且值不同时标记时间性差异', () => {
    const conflicts = detectConflicts([
      {
        subject: 'API',
        predicate: '默认行为',
        value: '返回完整结果',
        evidenceChunkId: chunk('05'),
        observedAt: '2025-01-01T00:00:00.000Z',
      },
      {
        subject: 'API',
        predicate: '默认行为',
        value: '返回分页结果',
        evidenceChunkId: chunk('06'),
        observedAt: '2026-01-01T00:00:00.000Z',
      },
    ]);

    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]?.type).toBe('temporal');
  });

  it('相同值不产生冲突', () => {
    const conflicts = detectConflicts([
      { subject: 'RRF', predicate: '默认 k 值', value: '60', evidenceChunkId: chunk('07') },
      { subject: 'RRF', predicate: '默认 k 值', value: '60', evidenceChunkId: chunk('08') },
    ]);

    expect(conflicts).toHaveLength(0);
  });

  it('构造 10 组冲突全部标记', () => {
    const facts: ConflictFact[] = [];
    for (let index = 0; index < 4; index += 1) {
      facts.push(
        {
          subject: 'S',
          predicate: `p-num-${index}`,
          value: `${index + 1}`,
          evidenceChunkId: chunk(`${10 + index}`),
        },
        {
          subject: 'S',
          predicate: `p-num-${index}`,
          value: `${index + 2}`,
          evidenceChunkId: chunk(`${20 + index}`),
        },
      );
    }
    for (let index = 0; index < 3; index += 1) {
      facts.push(
        {
          subject: 'S',
          predicate: `p-neg-${index}`,
          value: '支持',
          evidenceChunkId: chunk(`${30 + index}`),
        },
        {
          subject: 'S',
          predicate: `p-neg-${index}`,
          value: '不支持',
          evidenceChunkId: chunk(`${40 + index}`),
        },
      );
    }
    for (let index = 0; index < 3; index += 1) {
      facts.push(
        {
          subject: 'S',
          predicate: `p-time-${index}`,
          value: '旧行为',
          evidenceChunkId: chunk(`${50 + index}`),
          observedAt: '2025-06-01T00:00:00.000Z',
        },
        {
          subject: 'S',
          predicate: `p-time-${index}`,
          value: '新行为',
          evidenceChunkId: chunk(`${60 + index}`),
          observedAt: '2026-06-01T00:00:00.000Z',
        },
      );
    }

    const conflicts = detectConflicts(facts);
    expect(conflicts).toHaveLength(10);
    expect(conflicts.filter((item) => item.type === 'numeric')).toHaveLength(4);
    expect(conflicts.filter((item) => item.type === 'negation')).toHaveLength(3);
    expect(conflicts.filter((item) => item.type === 'temporal')).toHaveLength(3);
  });
});
