import type { FastifyPluginAsync } from 'fastify';
import type { z } from 'zod';
import {
  ApiError,
  CreateWikiPageSchema,
  UpdateWikiPageSchema,
  WikiAcceptProposalSchema,
  WikiMergeEntitySchema,
  WikiRejectProposalSchema,
  WikiResolveConflictSchema,
  WikiResolveStaleSchema,
  WikiRevisionInputSchema,
  WikiRewriteProposalSchema,
  WikiRollbackSchema,
  WikiTriggerExtractionSchema,
} from '@kos/shared';
import type { AppDeps } from '../../deps.js';

function parse<T extends z.ZodTypeAny>(schema: T, input: unknown): z.infer<T> {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new ApiError('INVALID_ARGUMENT');
  }
  return result.data;
}

export const wikiRoutes: FastifyPluginAsync<{ deps: AppDeps }> = async (app, opts) => {
  const service = opts.deps.wiki;

  app.get('/api/v1/wiki/pages', async (request) => {
    const query = request.query as { type?: string; status?: string; limit?: string };
    return service.listPages({
      ...(query.type ? { type: query.type } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.limit ? { limit: Number(query.limit) } : {}),
    });
  });

  app.post('/api/v1/wiki/pages', async (request, reply) => {
    const input = parse(CreateWikiPageSchema, request.body);
    return reply.status(201).send(await service.createPage(input));
  });

  app.get('/api/v1/wiki/pages/:slug', async (request) => {
    const { slug } = request.params as { slug: string };
    return service.getPage(slug);
  });

  app.patch('/api/v1/wiki/pages/:slug', async (request) => {
    const { slug } = request.params as { slug: string };
    const input = parse(UpdateWikiPageSchema, request.body);
    return service.updatePage(slug, input);
  });

  app.get('/api/v1/wiki/pages/:slug/revisions', async (request) => {
    const { slug } = request.params as { slug: string };
    return service.listRevisions(slug);
  });

  app.post('/api/v1/wiki/pages/:slug/revisions', async (request, reply) => {
    const { slug } = request.params as { slug: string };
    const input = parse(WikiRevisionInputSchema, request.body);
    return reply.status(201).send(await service.saveRevision(slug, input));
  });

  app.get('/api/v1/wiki/pages/:slug/diff', async (request) => {
    const { slug } = request.params as { slug: string };
    const query = request.query as { from?: string; to?: string };
    if (!query.from || !query.to) {
      throw new ApiError('INVALID_ARGUMENT', '需要提供 from 与 to');
    }
    return service.diff(slug, query.from, query.to);
  });

  app.post('/api/v1/wiki/pages/:slug/rollback', async (request) => {
    const { slug } = request.params as { slug: string };
    const input = parse(WikiRollbackSchema, request.body);
    return service.rollback(slug, input.targetRevisionId, input.reason);
  });

  app.post('/api/v1/wiki/pages/:slug/stale', async (request) => {
    const { slug } = request.params as { slug: string };
    const input = parse(WikiResolveStaleSchema, request.body);
    return service.resolveStale(slug, input.action);
  });

  app.get('/api/v1/wiki/proposals', async (request) => {
    const query = request.query as { status?: string; limit?: string };
    return service.listProposals({
      ...(query.status ? { status: query.status } : {}),
      ...(query.limit ? { limit: Number(query.limit) } : {}),
    });
  });

  app.get('/api/v1/wiki/proposals/:id', async (request) => {
    const { id } = request.params as { id: string };
    return service.getProposal(id);
  });

  app.post('/api/v1/wiki/proposals/:id/accept', async (request) => {
    const { id } = request.params as { id: string };
    const input = parse(WikiAcceptProposalSchema, request.body);
    return service.acceptProposal(id, input.baseRevisionId);
  });

  app.post('/api/v1/wiki/proposals/:id/reject', async (request) => {
    const { id } = request.params as { id: string };
    const input = parse(WikiRejectProposalSchema, request.body);
    return service.rejectProposal(id, input.reason, input.comment);
  });

  app.post('/api/v1/wiki/proposals/:id/rewrite', async (request) => {
    const { id } = request.params as { id: string };
    const input = parse(WikiRewriteProposalSchema, request.body);
    return service.rewriteProposal(id, input);
  });

  app.get('/api/v1/wiki/review-tasks', async (request) => {
    const query = request.query as { status?: string };
    return service.listReviewTasks(query.status);
  });

  app.get('/api/v1/wiki/conflicts', async () => service.listConflicts());

  app.post('/api/v1/wiki/conflicts/:id/resolve', async (request) => {
    const { id } = request.params as { id: string };
    const input = parse(WikiResolveConflictSchema, request.body);
    return service.resolveConflict(id, input.resolution, input.reason);
  });

  app.get('/api/v1/entities', async (request) => {
    const query = request.query as { q?: string };
    return service.listEntities(query.q);
  });

  app.get('/api/v1/entities/:id', async (request) => {
    const { id } = request.params as { id: string };
    return service.getEntity(id);
  });

  app.post('/api/v1/entities/:id/merge', async (request) => {
    const { id } = request.params as { id: string };
    const input = parse(WikiMergeEntitySchema, request.body);
    return service.mergeEntity(id, input.targetEntityId);
  });

  app.post('/api/v1/wiki/extract', async (request, reply) => {
    const input = parse(WikiTriggerExtractionSchema, request.body);
    return reply.status(202).send(await service.triggerExtraction(input.documentId));
  });
};
