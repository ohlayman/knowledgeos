import type { FastifyPluginAsync } from 'fastify';
import {
  ApiError,
  ProviderKindSchema,
  ProviderSaveSchema,
  SettingsUpdateSchema,
  TestConnectionSchema,
} from '@kos/shared';
import type { AppDeps } from '../../deps.js';

export const settingsRoutes: FastifyPluginAsync<{ deps: AppDeps }> = async (app, opts) => {
  app.get('/api/v1/settings', async (_request, reply) => {
    return reply.send(await opts.deps.settings.overview());
  });

  app.put('/api/v1/settings', async (request, reply) => {
    const parsed = SettingsUpdateSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new ApiError('INVALID_ARGUMENT', '设置参数不合法');
    }
    return reply.send(await opts.deps.settings.update(parsed.data));
  });

  app.put('/api/v1/settings/providers/:kind', async (request, reply) => {
    const params = ProviderKindSchema.safeParse((request.params as { kind?: string }).kind);
    if (!params.success || params.data === 'rerank') {
      throw new ApiError('INVALID_ARGUMENT', '不支持的模型用途');
    }

    const parsed = ProviderSaveSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new ApiError('INVALID_ARGUMENT', '模型配置不合法');
    }

    return reply.send(await opts.deps.settings.saveProvider(params.data, parsed.data));
  });

  app.post('/api/v1/settings/test-connection', async (request, reply) => {
    const parsed = TestConnectionSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new ApiError('INVALID_ARGUMENT', '连接测试参数不合法');
    }

    return reply.send(await opts.deps.settings.testConnection(parsed.data));
  });
};
