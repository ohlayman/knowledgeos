import type { FastifyPluginAsync } from 'fastify';
import {
  ApiError,
  CreateConversationInputSchema,
  FeedbackInputSchema,
  SendMessageInputSchema,
  toErrorEnvelope,
} from '@kos/shared';
import type { AppDeps } from '../../deps.js';
import type { AnswerSink } from './conversation-service.js';

export const conversationRoutes: FastifyPluginAsync<{ deps: AppDeps }> = async (app, opts) => {
  app.get('/api/v1/conversations', async (_request, reply) => {
    return reply.send(await opts.deps.conversations.list());
  });

  app.post('/api/v1/conversations', async (request, reply) => {
    const parsed = CreateConversationInputSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      throw new ApiError('INVALID_ARGUMENT', '会话参数不合法');
    }
    return reply.status(201).send(await opts.deps.conversations.create(parsed.data));
  });

  app.get('/api/v1/conversations/:id', async (request) => {
    const { id } = request.params as { id: string };
    return opts.deps.conversations.get(id);
  });

  app.delete('/api/v1/conversations/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    await opts.deps.conversations.remove(id);
    return reply.status(204).send();
  });

  app.post('/api/v1/conversations/:id/messages', async (request, reply) => {
    const parsed = SendMessageInputSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new ApiError('INVALID_ARGUMENT', '消息参数不合法');
    }

    const { id } = request.params as { id: string };
    reply.hijack();

    const raw = reply.raw;
    raw.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-request-id': request.id,
    });

    const controller = new AbortController();
    (request.raw as NodeJS.EventEmitter).on('close', () => {
      controller.abort();
    });

    const send = (event: string, data: unknown): void => {
      if (!raw.writableEnded) {
        raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      }
    };

    const sink: AnswerSink = {
      meta: (payload) => send('meta', payload),
      status: (payload) => send('status', payload),
      retrieval: (payload) => send('retrieval', payload),
      delta: (text) => send('delta', { text }),
      citations: (payload) => send('citations', payload),
      done: (payload) => send('done', payload),
      error: (payload) => send('error', payload),
    };

    try {
      await opts.deps.conversations.answer(id, parsed.data, sink, controller.signal);
    } catch (error) {
      const envelope = toErrorEnvelope(error, request.id);
      send('error', envelope.error);
    } finally {
      raw.end();
    }
  });

  app.get('/api/v1/messages/:id', async (request) => {
    const { id } = request.params as { id: string };
    return opts.deps.conversations.getMessage(id);
  });

  app.post('/api/v1/messages/:id/feedback', async (request, reply) => {
    const parsed = FeedbackInputSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new ApiError('INVALID_ARGUMENT', '反馈参数不合法');
    }

    const { id } = request.params as { id: string };
    return reply.status(201).send(await opts.deps.conversations.feedback(id, parsed.data));
  });
};
