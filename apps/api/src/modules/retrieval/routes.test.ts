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
    conversations: {} as AppDeps['conversations'],
    settings: {} as AppDeps['settings'],
    metrics: {} as AppDeps['metrics'],
    retrieval: { retrieve: vi.fn() } as unknown as AppDeps['retrieval'],
    chunks: {} as AppDeps['chunks'],
    urlFetcher: { fetch: vi.fn() },
  } as AppDeps;
}

describe('POST /api/v1/retrieval/search', () => {
  it('returns evidence and trace', async () => {
    const deps = fakeDeps();
    vi.mocked(deps.retrieval.retrieve).mockResolvedValue({
      evidence: [],
      noEvidence: true,
      trace: { questionType: 'open', degraded: [] },
    } as never);
    const app = buildApp(deps);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/retrieval/search',
      payload: { query: '混合检索', topK: 5, tags: ['rag'] },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().trace.questionType).toBe('open');
    expect(deps.retrieval.retrieve).toHaveBeenCalledWith('混合检索', {
      tags: ['rag'],
      finalTopK: 5,
    });
    await app.close();
  });

  it('rejects an empty query', async () => {
    const deps = fakeDeps();
    const app = buildApp(deps);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/retrieval/search',
      payload: { query: '   ' },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('INVALID_ARGUMENT');
    await app.close();
  });
});
