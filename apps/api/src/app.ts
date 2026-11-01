import { randomUUID } from 'node:crypto';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import Fastify, { type FastifyInstance } from 'fastify';
import { ApiError, toErrorEnvelope } from '@kos/shared';
import type { AppDeps } from './deps.js';
import { chunkRoutes } from './modules/chunks/routes.js';
import { conversationRoutes } from './modules/conversations/routes.js';
import { documentRoutes } from './modules/documents/routes.js';
import { jobRoutes } from './modules/jobs/routes.js';
import { maintenanceRoutes } from './modules/maintenance/routes.js';
import { metricsRoutes } from './modules/metrics/routes.js';
import { settingsRoutes } from './modules/settings/routes.js';
import { retrievalRoutes } from './modules/retrieval/routes.js';
import { wikiRoutes } from './modules/wiki/routes.js';
import { graphRoutes } from './modules/graph/routes.js';
import { agentRoutes } from './modules/agents/routes.js';
import { mcpRoutes } from './modules/mcp/routes.js';
import { healthRoutes } from './routes/health.js';

export function buildApp(deps: AppDeps): FastifyInstance {
  const app = Fastify({
    logger: { level: deps.env.LOG_LEVEL },
    genReqId: () => randomUUID(),
  });

  app.register(helmet);
  app.register(cors, { origin: deps.env.WEB_ORIGIN });

  app.addHook('onRequest', async (request, reply) => {
    reply.header('x-request-id', request.id);
  });

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ApiError) {
      void reply.status(error.status).send(toErrorEnvelope(error, request.id));
      return;
    }

    const frameworkStatus = (error as { statusCode?: number }).statusCode;
    if (frameworkStatus && frameworkStatus >= 400 && frameworkStatus < 500) {
      const wrapped = new ApiError(
        'INVALID_ARGUMENT',
        (error as { message?: string }).message ?? '请求不合法',
      );
      void reply.status(frameworkStatus).send(toErrorEnvelope(wrapped, request.id));
      return;
    }

    request.log.error({ err: error }, 'request failed');
    void reply.status(500).send(toErrorEnvelope(error, request.id));
  });

  app.setNotFoundHandler((request, reply) => {
    void reply.status(404).send(toErrorEnvelope(new ApiError('NOT_FOUND'), request.id));
  });

  app.register(healthRoutes, { deps });
  app.register(documentRoutes, { deps });
  app.register(jobRoutes, { deps });
  app.register(retrievalRoutes, { deps });
  app.register(conversationRoutes, { deps });
  app.register(settingsRoutes, { deps });
  app.register(metricsRoutes, { deps });
  app.register(chunkRoutes, { deps });
  app.register(maintenanceRoutes, { deps });
  app.register(wikiRoutes, { deps });
  app.register(graphRoutes, { deps });
  app.register(agentRoutes, { deps });
  app.register(mcpRoutes, { deps });

  return app;
}
