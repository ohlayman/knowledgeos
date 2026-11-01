import type { FastifyPluginAsync } from 'fastify';
import type { z } from 'zod';
import { ApiError, CreateAgentSchema, TriggerAgentRunSchema, UpdateAgentSchema } from '@kos/shared';
import type { AppDeps } from '../../deps.js';

function parse<T extends z.ZodTypeAny>(schema: T, input: unknown): z.infer<T> {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new ApiError('INVALID_ARGUMENT');
  }
  return result.data;
}

export const agentRoutes: FastifyPluginAsync<{ deps: AppDeps }> = async (app, opts) => {
  const service = opts.deps.agents;

  app.get('/api/v1/agents/tools', async () => service.listTools());

  app.get('/api/v1/agents', async () => service.listAgents());

  app.post('/api/v1/agents', async (request, reply) => {
    const input = parse(CreateAgentSchema, request.body);
    return reply.status(201).send(await service.createAgent(input));
  });

  app.get('/api/v1/agents/usage', async () => service.usage());

  app.get('/api/v1/agents/:id', async (request) => {
    const { id } = request.params as { id: string };
    return service.getAgent(id);
  });

  app.put('/api/v1/agents/:id', async (request) => {
    const { id } = request.params as { id: string };
    const input = parse(UpdateAgentSchema, request.body);
    return service.updateAgent(id, input);
  });

  app.post('/api/v1/agents/:id/archive', async (request) => {
    const { id } = request.params as { id: string };
    return service.archiveAgent(id);
  });

  app.get('/api/v1/agents/:id/estimate', async (request) => {
    const { id } = request.params as { id: string };
    return service.estimate(id);
  });

  app.get('/api/v1/agents/:id/runs', async (request) => {
    const { id } = request.params as { id: string };
    return opts.deps.prisma.agentRun.findMany({
      where: { agentId: id },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  });

  app.post('/api/v1/agents/:id/runs', async (request, reply) => {
    const { id } = request.params as { id: string };
    const input = parse(TriggerAgentRunSchema, request.body);
    return reply.status(202).send(await service.trigger(id, input.input));
  });

  app.get('/api/v1/agent-runs/:runId', async (request) => {
    const { runId } = request.params as { runId: string };
    const run = await opts.deps.prisma.agentRun.findUnique({
      where: { id: runId },
      include: {
        steps: { orderBy: { stepIndex: 'asc' } },
        toolCalls: { orderBy: { stepIndex: 'asc' } },
        agent: true,
        agentVersion: true,
      },
    });
    if (!run) {
      throw new ApiError('NOT_FOUND', '执行记录不存在');
    }
    return run;
  });

  app.post('/api/v1/agent-runs/:runId/cancel', async (request) => {
    const { runId } = request.params as { runId: string };
    return service.cancelRun(runId);
  });

  app.delete('/api/v1/agent-runs/:runId', async (request, reply) => {
    const { runId } = request.params as { runId: string };
    await service.deleteRun(runId);
    return reply.status(204).send();
  });
};
