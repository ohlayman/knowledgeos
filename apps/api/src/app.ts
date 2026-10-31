import { randomUUID } from 'node:crypto';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import Fastify, { type FastifyInstance } from 'fastify';
import { ApiError, toErrorEnvelope } from '@kos/shared';
import type { AppDeps } from './deps.js';
import { conversationRoutes } from './modules/conversations/routes.js';
import { documentRoutes } from './modules/documents/routes.js';
import { jobRoutes } from './modules/jobs/routes.js';
import { retrievalRoutes } from './modules/retrieval/routes.js';
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
    const status = error instanceof ApiError ? error.status : 500;
    void reply.status(status).send(toErrorEnvelope(error, request.id));
  });

  app.setNotFoundHandler((request, reply) => {
    void reply.status(404).send(toErrorEnvelope(new ApiError('NOT_FOUND'), request.id));
  });

  app.register(healthRoutes, { deps });
  app.register(documentRoutes, { deps });
  app.register(jobRoutes, { deps });
  app.register(retrievalRoutes, { deps });
  app.register(conversationRoutes, { deps });

  return app;
}
