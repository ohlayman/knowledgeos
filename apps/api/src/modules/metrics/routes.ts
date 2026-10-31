import type { FastifyPluginAsync } from 'fastify';
import type { AppDeps } from '../../deps.js';

export const metricsRoutes: FastifyPluginAsync<{ deps: AppDeps }> = async (app, opts) => {
  app.get('/api/v1/metrics/overview', async (_request, reply) => {
    return reply.send(await opts.deps.metrics.overview());
  });
};
