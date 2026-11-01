import type { FastifyPluginAsync } from 'fastify';
import { ApiError } from '@kos/shared';
import type { AppDeps } from '../../deps.js';

function intParam(value: string | undefined, fallback: number, min: number, max: number): number {
  if (value === undefined) {
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) {
    throw new ApiError('INVALID_ARGUMENT');
  }
  return Math.min(max, Math.max(min, parsed));
}

export const graphRoutes: FastifyPluginAsync<{ deps: AppDeps }> = async (app, opts) => {
  const graph = opts.deps.graph;

  app.get('/api/v1/graph/entry', async (request) => {
    const query = request.query as { limit?: string };
    return graph.entry(intParam(query.limit, 20, 1, 50));
  });

  app.get('/api/v1/graph/entities/:id/neighbors', async (request) => {
    const { id } = request.params as { id: string };
    const query = request.query as { hops?: string; maxNodes?: string };
    return graph.neighborhood(
      id,
      intParam(query.hops, 1, 1, 3),
      intParam(query.maxNodes, 500, 20, 500),
    );
  });

  app.get('/api/v1/graph/paths', async (request) => {
    const query = request.query as { from?: string; to?: string; maxHops?: string };
    if (!query.from || !query.to) {
      throw new ApiError('INVALID_ARGUMENT', '需要提供 from 与 to');
    }
    return graph.paths(query.from, query.to, intParam(query.maxHops, 3, 1, 3));
  });

  app.get('/api/v1/graph/relations', async (request) => {
    const query = request.query as { limit?: string; status?: string };
    const limit = intParam(query.limit, 200, 1, 500);
    const rows = await opts.deps.prisma.relation.findMany({
      orderBy: { createdAt: 'desc' },
      take: limit,
      ...(query.status ? { where: { status: query.status as never } } : {}),
      include: {
        fromEntity: { select: { canonicalName: true, type: true } },
        toEntity: { select: { canonicalName: true, type: true } },
      },
    });
    return rows.map((row) => ({
      id: row.id,
      from: row.fromEntity.canonicalName,
      to: row.toEntity.canonicalName,
      type: row.type,
      confidence: row.confidence,
      status: row.status,
      origin: row.origin,
      evidenceChunkIds: row.evidenceChunkIds,
    }));
  });

  app.get('/api/v1/graph/pending', async (request) => {
    const query = request.query as { limit?: string };
    return graph.pendingRelations(intParam(query.limit, 100, 1, 200));
  });

  app.post('/api/v1/graph/relations/:id/confirm', async (request) => {
    const { id } = request.params as { id: string };
    return graph.confirmRelation(id);
  });

  app.get('/api/v1/entities/:id/mentions', async (request) => {
    const { id } = request.params as { id: string };
    return opts.deps.prisma.entityMention.findMany({
      where: { entityId: id },
      orderBy: { createdAt: 'asc' },
      take: 200,
      select: {
        id: true,
        chunkId: true,
        startOffset: true,
        endOffset: true,
        chunk: { select: { id: true, documentId: true, text: true } },
      },
    });
  });

  app.post('/api/v1/entities/:id/unmerge', async (request) => {
    const { id } = request.params as { id: string };
    await graph.undoMerge(id);
    return { id, status: 'active' };
  });
};
