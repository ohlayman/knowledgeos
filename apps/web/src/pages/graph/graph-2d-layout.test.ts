import { describe, expect, it } from 'vitest';
import type { GraphNode } from '../../features/schemas.js';
import { initialPosition, nextPositions } from './graph-2d-layout.js';

const node = (id: string): GraphNode => ({
  id,
  name: id,
  type: 'concept',
  aliases: [],
  mentionCount: 1,
  confidence: 0.8,
  mergedIntoId: null,
});

describe('graph 2d layout', () => {
  it('keeps existing positions when new nodes arrive', () => {
    const existing = new Map([['a', { x: 10, y: 20 }]]);
    const next = nextPositions([node('a'), node('b')], existing);

    expect(next.get('a')).toEqual({ x: 10, y: 20 });
    expect(next.get('b')).toBeDefined();
    expect(next.get('b')).not.toEqual({ x: 10, y: 20 });
  });

  it('places new nodes around the expanded parent', () => {
    const parent = { x: 450, y: 310 };
    const next = nextPositions([node('a'), node('b'), node('c')], new Map([['a', parent]]), parent);

    for (const id of ['b', 'c']) {
      const point = next.get(id)!;
      const distance = Math.hypot(point.x - parent.x, point.y - parent.y);
      expect(distance).toBeGreaterThan(80);
      expect(distance).toBeLessThan(220);
    }
  });

  it('initial positions are deterministic per id', () => {
    expect(initialPosition('entity-a', 0)).toEqual(initialPosition('entity-a', 0));
  });
});
