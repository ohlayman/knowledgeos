import type { FastifyPluginAsync } from 'fastify';
import { ApiError, RetrievalSearchInputSchema } from '@kos/shared';
import type { AppDeps } from '../../deps.js';

export const retrievalRoutes: FastifyPluginAsync<{ deps: AppDeps }> = async (app, opts) => {
  app.post('/api/v1/retrieval/search', async (request, reply) => {
    const parsed = RetrievalSearchInputSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new ApiError('INVALID_ARGUMENT', '检索参数不合法');
    }

    const { query, topK, ...options } = parsed.data;
    const result = await opts.deps.retrieval.retrieve(query, {
      ...options,
      ...(topK === undefined ? {} : { finalTopK: topK }),
    });

    return reply.send(result);
  });
};
