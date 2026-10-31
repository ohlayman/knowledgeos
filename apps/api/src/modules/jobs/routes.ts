import type { FastifyPluginAsync } from 'fastify';
import { ApiError, JobListQuerySchema, JobRetryInputSchema } from '@kos/shared';
import type { AppDeps } from '../../deps.js';

export const jobRoutes: FastifyPluginAsync<{ deps: AppDeps }> = async (app, opts) => {
  app.get('/api/v1/jobs', async (request, reply) => {
    const parsed = JobListQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      throw new ApiError('INVALID_ARGUMENT', '查询参数不合法');
    }

    return reply.send(await opts.deps.jobs.list(parsed.data));
  });

  app.get('/api/v1/jobs/:id', async (request) => {
    const { id } = request.params as { id: string };
    return opts.deps.jobs.get(id);
  });

  app.post('/api/v1/jobs/:id/retry', async (request, reply) => {
    const parsed = JobRetryInputSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new ApiError('INVALID_ARGUMENT', '重试参数不合法');
    }

    const { id } = request.params as { id: string };
    return reply.status(202).send(await opts.deps.jobs.retry(id, parsed.data));
  });

  app.post('/api/v1/jobs/:id/cancel', async (request, reply) => {
    const { id } = request.params as { id: string };
    await opts.deps.jobs.cancel(id);
    return reply.status(204).send();
  });
};
