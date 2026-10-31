import { ApiError } from '@kos/shared';
import { describe, expect, it, vi } from 'vitest';
import type { AppDeps } from '../../deps.js';
import { buildApp } from '../../app.js';

function fakeDeps(): AppDeps {
  return {
    env: {
      NODE_ENV: 'test',
      HOST: '127.0.0.1',
      PORT: 3000,
      WEB_ORIGIN: 'http://localhost:5173',
      DATABASE_URL: 'postgresql://user:pass@localhost:5432/knowledgeos',
      REDIS_URL: 'redis://localhost:6379',
      QDRANT_URL: 'http://localhost:6333',
      DATA_DIR: './data',
      EMBEDDING_MODEL: 'text-embedding-3-small',
      EMBEDDING_DIM: 1536,
      LOG_LEVEL: 'fatal',
    },
    db: { ping: vi.fn(), close: vi.fn() },
    redis: { ping: vi.fn(), close: vi.fn() },
    qdrant: { ping: vi.fn() },
    prisma: {} as AppDeps['prisma'],
    storage: {} as AppDeps['storage'],
    queue: { close: vi.fn() },
    documents: {} as AppDeps['documents'],
    jobs: {} as AppDeps['jobs'],
    retrieval: {} as AppDeps['retrieval'],
    conversations: {
      list: vi.fn(),
      create: vi.fn(),
      get: vi.fn(),
      remove: vi.fn(),
      getMessage: vi.fn(),
      feedback: vi.fn(),
      answer: vi.fn(async (conversationId: string, _input, sink) => {
        sink.meta({ conversationId, messageId: 'msg-1' });
        sink.status({ phase: 'retrieving' });
        sink.retrieval({ vectorCount: 1, keywordCount: 1, finalChunkIds: ['c1'], degraded: [] });
        sink.delta('你好');
        sink.citations({ citations: [] });
        sink.done({ status: 'complete' });
      }),
    } as unknown as AppDeps['conversations'],
    urlFetcher: { fetch: vi.fn() },
  } as AppDeps;
}

describe('conversation routes', () => {
  it('streams SSE events for an answer', async () => {
    const deps = fakeDeps();
    const app = buildApp(deps);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/conversations/conv-1/messages',
      payload: { content: '什么是混合检索？' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('text/event-stream');
    expect(response.payload).toContain('event: meta');
    expect(response.payload).toContain('"messageId":"msg-1"');
    expect(response.payload).toContain('event: delta');
    expect(response.payload).toContain('"text":"你好"');
    expect(response.payload).toContain('event: done');
    expect(deps.conversations.answer).toHaveBeenCalledWith(
      'conv-1',
      expect.objectContaining({ content: '什么是混合检索？' }),
      expect.anything(),
      expect.anything(),
    );
    await app.close();
  });

  it('rejects an empty message', async () => {
    const deps = fakeDeps();
    const app = buildApp(deps);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/conversations/conv-1/messages',
      payload: { content: '   ' },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('INVALID_ARGUMENT');
    await app.close();
  });

  it('creates and lists conversations', async () => {
    const deps = fakeDeps();
    vi.mocked(deps.conversations.create).mockResolvedValue({
      id: 'conv-1',
      title: '新会话',
    } as never);
    vi.mocked(deps.conversations.list).mockResolvedValue([{ id: 'conv-1' }] as never);
    const app = buildApp(deps);

    const created = await app.inject({ method: 'POST', url: '/api/v1/conversations', payload: {} });
    expect(created.statusCode).toBe(201);

    const listed = await app.inject({ method: 'GET', url: '/api/v1/conversations' });
    expect(listed.json()).toHaveLength(1);
    await app.close();
  });

  it('returns 404 for a deleted conversation', async () => {
    const deps = fakeDeps();
    vi.mocked(deps.conversations.get).mockRejectedValue(new ApiError('NOT_FOUND'));
    const app = buildApp(deps);

    const response = await app.inject({ method: 'GET', url: '/api/v1/conversations/missing' });

    expect(response.statusCode).toBe(404);
    await app.close();
  });

  it('requires a citation ordinal for citation_wrong feedback', async () => {
    const deps = fakeDeps();
    const app = buildApp(deps);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/messages/msg-1/feedback',
      payload: { type: 'citation_wrong' },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('INVALID_ARGUMENT');
    await app.close();
  });

  it('stores feedback', async () => {
    const deps = fakeDeps();
    vi.mocked(deps.conversations.feedback).mockResolvedValue({ id: 'fb-1' } as never);
    const app = buildApp(deps);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/messages/msg-1/feedback',
      payload: { type: 'citation_wrong', citationOrdinal: 1 },
    });

    expect(response.statusCode).toBe(201);
    expect(deps.conversations.feedback).toHaveBeenCalledWith('msg-1', {
      type: 'citation_wrong',
      citationOrdinal: 1,
    });
    await app.close();
  });
});
