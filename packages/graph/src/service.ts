import { scorePath } from './score.js';
import type {
  EntryNode,
  GraphEdge,
  GraphNeighborhood,
  GraphNode,
  GraphPath,
  GraphStore,
} from './types.js';

const DEFAULT_MAX_HOPS = 3;
const DEFAULT_MAX_NODES = 500;

export class GraphService {
  constructor(private readonly store: GraphStore) {}

  async entry(limit = 20): Promise<EntryNode[]> {
    return this.store.listEntryNodes(limit);
  }

  async neighborhood(
    entityId: string,
    hops = 1,
    maxNodes = DEFAULT_MAX_NODES,
  ): Promise<GraphNeighborhood> {
    const merged = await this.store.resolveMergedMap();
    const resolve = (id: string): string => {
      let current = id;
      const seen = new Set<string>();
      while (merged.has(current) && !seen.has(current)) {
        seen.add(current);
        current = merged.get(current)!;
      }
      return current;
    };

    const root = resolve(entityId);
    const nodeIds = new Set<string>([root]);
    const edges = new Map<string, GraphEdge>();
    let frontier = [root];
    let truncated = false;

    for (let hop = 0; hop < hops; hop += 1) {
      if (frontier.length === 0) {
        break;
      }
      const relations = await this.store.listRelations(frontier);
      const next = new Set<string>();
      for (const relation of relations) {
        if (relation.status !== 'active') {
          continue;
        }
        const from = resolve(relation.fromId);
        const to = resolve(relation.toId);
        if (from === to) {
          continue;
        }
        const edgeKey = `${from}|${to}|${relation.type}`;
        if (!edges.has(edgeKey)) {
          edges.set(edgeKey, { ...relation, fromId: from, toId: to });
        }
        if (!nodeIds.has(from)) {
          next.add(from);
        }
        if (!nodeIds.has(to)) {
          next.add(to);
        }
      }
      for (const id of next) {
        if (nodeIds.size >= maxNodes) {
          truncated = true;
          break;
        }
        nodeIds.add(id);
      }
      frontier = [...next].filter((id) => nodeIds.has(id));
    }

    const nodes = await this.store.getEntities([...nodeIds]);
    return { nodes, edges: [...edges.values()], truncated };
  }

  async paths(
    fromId: string,
    toId: string,
    maxHops = DEFAULT_MAX_HOPS,
    maxPaths = 20,
  ): Promise<GraphPath[]> {
    const merged = await this.store.resolveMergedMap();
    const resolve = (id: string): string => {
      let current = id;
      const seen = new Set<string>();
      while (merged.has(current) && !seen.has(current)) {
        seen.add(current);
        current = merged.get(current)!;
      }
      return current;
    };

    const start = resolve(fromId);
    const target = resolve(toId);
    if (start === target) {
      return [];
    }

    interface Partial {
      nodeIds: string[];
      edges: GraphEdge[];
    }
    const results: Partial[] = [];
    const queue: Partial[] = [{ nodeIds: [start], edges: [] }];

    while (queue.length > 0 && results.length < maxPaths * 4) {
      const current = queue.shift()!;
      if (current.edges.length >= maxHops) {
        continue;
      }
      const last = current.nodeIds.at(-1)!;
      const relations = await this.store.listRelations([last]);
      for (const relation of relations) {
        if (relation.status !== 'active') {
          continue;
        }
        const to = resolve(relation.toId);
        const from = resolve(relation.fromId);
        const next = from === last ? to : to === last ? from : null;
        if (!next || current.nodeIds.includes(next)) {
          continue;
        }
        const edge: GraphEdge = { ...relation, fromId: from, toId: to };
        const partial: Partial = {
          nodeIds: [...current.nodeIds, next],
          edges: [...current.edges, edge],
        };
        if (next === target) {
          results.push(partial);
          if (results.length >= maxPaths * 4) {
            break;
          }
          continue;
        }
        queue.push(partial);
      }
    }

    const nodesById = new Map(
      (await this.store.getEntities([...new Set(results.flatMap((item) => item.nodeIds))])).map(
        (node) => [node.id, node],
      ),
    );

    return results
      .map((item) => {
        const scoring = scorePath(item.edges);
        const chunkIds = [...new Set(item.edges.flatMap((edge) => edge.evidenceChunkIds))];
        return {
          nodeIds: item.nodeIds,
          edgeIds: item.edges.map((edge) => edge.id),
          nodes: item.nodeIds
            .map((id) => nodesById.get(id))
            .filter((node): node is GraphNode => Boolean(node)),
          edges: item.edges,
          chunkIds,
          score: scoring.score,
          scoreBreakdown: {
            confidenceProduct: scoring.confidenceProduct,
            sourceQuality: scoring.sourceQuality,
            weakPenalty: scoring.weakPenalty,
          },
        };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, maxPaths);
  }

  async pendingRelations(limit = 100): Promise<GraphEdge[]> {
    return this.store.listPendingRelations(limit);
  }

  async confirmRelation(id: string): Promise<GraphEdge> {
    return this.store.confirmRelation(id);
  }

  async merge(sourceId: string, targetId: string): Promise<void> {
    if (sourceId === targetId) {
      throw new Error('cannot merge entity into itself');
    }
    await this.store.mergeEntity(sourceId, targetId);
  }

  async undoMerge(sourceId: string): Promise<void> {
    await this.store.undoMerge(sourceId);
  }

  async shouldUseGraph(questionType: string, entityIds: string[]): Promise<boolean> {
    if (questionType !== 'relation' && questionType !== 'comparison') {
      return false;
    }
    if (entityIds.length < 2) {
      return false;
    }
    const paths = await this.paths(entityIds[0]!, entityIds[1]!, 3, 3);
    return paths.length > 0;
  }
}
