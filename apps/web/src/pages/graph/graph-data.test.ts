import { describe, expect, it } from 'vitest';
import type { GraphEdge, GraphNode } from '../../features/schemas.js';
import { labelVisible, neighborsOf, toGraph3DData } from './graph-data.js';

const node = (id: string): GraphNode => ({
  id,
  name: id,
  type: 'concept',
  aliases: [],
  mentionCount: 1,
  confidence: 0.8,
  mergedIntoId: null,
});

const edge = (id: string, fromId: string, toId: string): GraphEdge => ({
  id,
  fromId,
  toId,
  type: 'USES',
  confidence: 0.9,
  evidenceChunkIds: [],
  status: 'active',
  origin: 'model',
  direction: 'out',
});

describe('toGraph3DData', () => {
  it('把 fromId/toId 转成 source/target，并丢掉悬空边', () => {
    const result = toGraph3DData(
      [node('a'), node('b')],
      [edge('e1', 'a', 'b'), edge('e2', 'a', 'missing')],
    );

    expect(result.nodes.map((item) => item.id)).toEqual(['a', 'b']);
    expect(result.links).toEqual([
      { id: 'e1', source: 'a', target: 'b', type: 'USES', status: 'active' },
    ]);
    expect(result.truncated).toBe(false);
  });

  it('超过上限时截断并标记原始数量', () => {
    const nodes = Array.from({ length: 6 }, (_, index) => node(`n${index}`));
    const edges = Array.from({ length: 6 }, (_, index) =>
      edge(`e${index}`, `n${index}`, `n${index + 1}`),
    );

    const result = toGraph3DData(nodes, edges, { maxNodes: 3, maxLinks: 2 });

    expect(result.nodes).toHaveLength(3);
    expect(result.links).toHaveLength(2);
    expect(result.truncated).toBe(true);
    expect(result.originalNodes).toBe(6);
    expect(result.originalLinks).toBe(6);
  });
});

describe('neighborsOf / labelVisible', () => {
  it('返回出入边的直接邻居', () => {
    expect([...neighborsOf([edge('e1', 'a', 'b'), edge('e2', 'c', 'a')], 'a')]).toEqual([
      'b',
      'c',
    ]);
  });

  it('150 内全部显示；超过后只显示选中、hover 与邻居', () => {
    const neighbors = new Set(['b']);
    expect(labelVisible(150, 'c', { selected: null, hovered: null, neighbors })).toBe(true);
    expect(labelVisible(200, 'c', { selected: null, hovered: null, neighbors })).toBe(false);
    expect(labelVisible(200, 'b', { selected: null, hovered: null, neighbors })).toBe(true);
    expect(labelVisible(200, 'c', { selected: 'c', hovered: null, neighbors })).toBe(true);
    expect(labelVisible(200, 'c', { selected: null, hovered: 'c', neighbors })).toBe(true);
  });
});
