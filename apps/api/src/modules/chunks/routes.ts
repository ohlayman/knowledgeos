import type { FastifyPluginAsync } from 'fastify';
import type { AppDeps } from '../../deps.js';

export const chunkRoutes: FastifyPluginAsync<{ deps: AppDeps }> = async (app, opts) => {
  app.get('/api/v1/versions/:id/chunks', async (request, reply) => {
    const { id } = request.params as { id: string };
    return reply.send(await opts.deps.chunks.listByVersion(id));
  });

  app.get('/api/v1/chunks/:id', async (request) => {
    const { id } = request.params as { id: string };
    return opts.deps.chunks.get(id);
  });
};
