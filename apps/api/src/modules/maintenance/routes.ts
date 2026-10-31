import type { FastifyPluginAsync } from 'fastify';
import { ApiError } from '@kos/shared';
import type { AppDeps } from '../../deps.js';

interface ClearBody {
  confirm?: unknown;
}

export const maintenanceRoutes: FastifyPluginAsync<{ deps: AppDeps }> = async (app, opts) => {
  app.get('/api/v1/export', async (_request, reply) => {
    const bundle = await opts.deps.maintenance.exportBundle();
    return reply
      .header('content-type', 'application/zip')
      .header(
        'content-disposition',
        `attachment; filename="knowledgeos-export-${new Date().toISOString().slice(0, 10)}.zip"`,
      )
      .send(bundle);
  });

  app.post('/api/v1/maintenance/clear', async (request, reply) => {
    const body = (request.body ?? {}) as ClearBody;
    if (body.confirm !== 'DELETE') {
      throw new ApiError('INVALID_ARGUMENT', '需要输入 DELETE 才能清空知识库');
    }

    return reply.send(await opts.deps.maintenance.clear(body.confirm));
  });
};
