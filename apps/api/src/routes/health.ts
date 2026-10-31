import type { FastifyPluginAsync } from 'fastify';
import type { AppDeps } from '../deps.js';

export const healthRoutes: FastifyPluginAsync<{ deps: AppDeps }> = async (app, opts) => {
  const { deps } = opts;

  app.get('/api/v1/health/live', async () => ({
    status: 'ok',
    uptime: process.uptime(),
  }));

  app.get('/api/v1/health/ready', async (_request, reply) => {
    const checks: Record<string, 'ok' | 'failed'> = {};
    const failed: string[] = [];

    await Promise.all(
      (
        [
          ['database', deps.db],
          ['redis', deps.redis],
          ['qdrant', deps.qdrant],
        ] as const
      ).map(async ([name, dependency]) => {
        try {
          await dependency.ping();
          checks[name] = 'ok';
        } catch {
          checks[name] = 'failed';
          failed.push(name);
        }
      }),
    );

    if (failed.length > 0) {
      return reply.status(503).send({ status: 'unavailable', checks, failed });
    }

    return { status: 'ok', checks };
  });
};
