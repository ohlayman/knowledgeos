import { describe, expect, it } from 'vitest';
import { GraphService } from './service.js';
import type { EntryNode, GraphEdge, GraphNode, GraphStore } from './types.js';

function node(id: string, name = id, mergedIntoId: string | null = null): GraphNode {
  return {
    id,
    name,
    type: 'concept',
    aliases: [],
    mentionCount: 1,
    confidence: 0.8,
    mergedIntoId,
  };
}

function edge(
  id: string,
  fromId: string,
  toId: string,
  type = 'USES',
  status = 'active',
  confidence = 0.9,
): GraphEdge {
  return {
    id,
    fromId,
    toId,
    type,
    confidence,
    evidenceChunkIds: [`chunk-${id}`],
    status,
    origin: 'extracted',
    direction: 'directed',
  };
}

function memoryStore(seed: {
  nodes: GraphNode[];
  edges: GraphEdge[];
  degrees?: Record<string, number>;
}): GraphStore {
  const nodes = new Map(seed.nodes.map((item) => [item.id, item]));
  const edges = seed.edges.slice();

  return {
    async getEntities(ids) {
      return ids.flatMap((id) => (nodes.has(id) ? [nodes.get(id)!] : []));
    },
    async resolveMergedMap() {
      return new Map(
        seed.nodes.filter((item) => item.mergedIntoId).map((item) => [item.id, item.mergedIntoId!]),
      );
    },
    async listRelations(ids) {
      return edges.filter((item) => ids.includes(item.fromId) || ids.includes(item.toId));
    },
    async listEntryNodes(limit): Promise<EntryNode[]> {
      return [...seed.nodes]
        .map((item) => ({ node: item, degree: seed.degrees?.[item.id] ?? 0 }))
        .sort((a, b) => b.degree - a.degree)
        .slice(0, limit);
    },
    async listPendingRelations(limit) {
      return edges.filter((item) => item.status === 'pending').slice(0, limit);
    },
    async confirmRelation(id) {
      const target = edges.find((item) => item.id === id)!;
      target.status = 'active';
      target.origin = 'human';
      return target;
    },
    async mergeEntity(sourceId, targetId) {
      nodes.get(sourceId)!.mergedIntoId = targetId;
    },
    async undoMerge(sourceId) {
      nodes.get(sourceId)!.mergedIntoId = null;
    },
  };
}

describe('GraphService', () => {
  const baseSeed = {
    nodes: [node('a', 'Qdrant'), node('b', '稀疏向量'), node('c', '混合检索'), node('x', '孤立')],
    edges: [
      edge('e1', 'a', 'b', 'USES'),
      edge('e2', 'b', 'c', 'PART_OF'),
      edge('e3', 'a', 'c', 'RELATED_TO', 'pending'),
      edge('e4', 'a', 'x', 'RELATED_TO', 'active', 0.5),
    ],
    degrees: { a: 3, b: 2, c: 2, x: 1 },
  };

  it('邻域只包含 active 关系，且默认一跳', async () => {
    const service = new GraphService(memoryStore(baseSeed));
    const oneHop = await service.neighborhood('a', 1);
    expect(oneHop.nodes.map((item) => item.id).sort()).toEqual(['a', 'b', 'x']);
    expect(oneHop.edges.map((item) => item.id).sort()).toEqual(['e1', 'e4']);

    const twoHops = await service.neighborhood('a', 2);
    expect(twoHops.nodes.map((item) => item.id).sort()).toEqual(['a', 'b', 'c', 'x']);
  });

  it('合并后的实体解析到目标实体', async () => {
    const service = new GraphService(
      memoryStore({
        nodes: [node('a'), node('b'), node('merged', '旧名', 'b')],
        edges: [edge('e1', 'a', 'merged', 'USES')],
      }),
    );

    const result = await service.neighborhood('a', 1);
    expect(result.edges[0]?.toId).toBe('b');
    expect(result.nodes.some((item) => item.id === 'merged')).toBe(false);
  });

  it('路径查询返回 ≤3 跳且带证据块', async () => {
    const service = new GraphService(memoryStore(baseSeed));
    const paths = await service.paths('a', 'c', 3);

    expect(paths.length).toBeGreaterThanOrEqual(1);
    const shortest = paths.find((path) => path.nodeIds.length === 3)!;
    expect(shortest.nodeIds).toEqual(['a', 'b', 'c']);
    expect(shortest.edgeIds).toEqual(['e1', 'e2']);
    expect(shortest.chunkIds.length).toBeGreaterThan(0);
    expect(shortest.scoreBreakdown.confidenceProduct).toBeGreaterThan(0);
  });

  it('路径按得分从高到低排序', async () => {
    const service = new GraphService(
      memoryStore({
        nodes: [node('a'), node('b'), node('c')],
        edges: [
          edge('direct', 'a', 'c', 'USES', 'active', 0.95),
          edge('e1', 'a', 'b', 'RELATED_TO', 'active', 0.5),
          edge('e2', 'b', 'c', 'RELATED_TO', 'active', 0.5),
        ],
      }),
    );

    const paths = await service.paths('a', 'c', 3);
    expect(paths[0]?.edgeIds).toEqual(['direct']);
    expect(paths.at(-1)?.edgeIds).toEqual(['e1', 'e2']);
  });

  it('只有关系型/对比型且存在路径时才走图', async () => {
    const service = new GraphService(memoryStore(baseSeed));

    expect(await service.shouldUseGraph('fact', ['a', 'c'])).toBe(false);
    expect(await service.shouldUseGraph('comparison', ['a'])).toBe(false);
    expect(await service.shouldUseGraph('comparison', ['a', 'c'])).toBe(true);
  });

  it('待定关系可确认并转为人工来源', async () => {
    const service = new GraphService(memoryStore(baseSeed));
    const pending = await service.pendingRelations();
    expect(pending.map((item) => item.id)).toEqual(['e3']);

    const confirmed = await service.confirmRelation('e3');
    expect(confirmed.status).toBe('active');
    expect(confirmed.origin).toBe('human');
  });

  it('合并与撤销保留历史关系', async () => {
    const service = new GraphService(memoryStore(baseSeed));
    await service.merge('a', 'b');
    const merged = await service.neighborhood('a', 1);
    expect(merged.nodes.some((item) => item.id === 'a')).toBe(false);
    expect(merged.nodes.some((item) => item.id === 'b')).toBe(true);

    await service.undoMerge('a');
    expect((await service.neighborhood('a', 1)).nodes.some((item) => item.id === 'a')).toBe(true);
  });
});
