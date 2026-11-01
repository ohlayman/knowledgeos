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
    conversations: {} as AppDeps['conversations'],
    settings: {} as AppDeps['settings'],
    metrics: {} as AppDeps['metrics'],
    chunks: {
      listByVersion: vi.fn(),
      get: vi.fn(),
    } as unknown as AppDeps['chunks'],
    maintenance: {} as AppDeps['maintenance'],
    urlFetcher: { fetch: vi.fn() },
    wiki: {} as AppDeps['wiki'],
    graph: {} as AppDeps['graph'],
    agents: {} as AppDeps['agents'],
    mcpTokens: {} as AppDeps['mcpTokens'],
    chatProvider: async () => {
      throw new Error('unused');
    },
  } as AppDeps;
}

describe('chunk routes', () => {
  it('lists chunks for a version', async () => {
    const deps = fakeDeps();
    vi.mocked(deps.chunks.listByVersion).mockResolvedValue({
      items: [{ id: 'c1', chunkIndex: 0, text: '块内容' }],
    } as never);
    const app = buildApp(deps);

    const response = await app.inject({ method: 'GET', url: '/api/v1/versions/v1/chunks' });

    expect(response.statusCode).toBe(200);
    expect(response.json().items).toHaveLength(1);
    await app.close();
  });

  it('returns 404 for a missing version', async () => {
    const deps = fakeDeps();
    vi.mocked(deps.chunks.listByVersion).mockRejectedValue(new ApiError('NOT_FOUND'));
    const app = buildApp(deps);

    const response = await app.inject({ method: 'GET', url: '/api/v1/versions/missing/chunks' });

    expect(response.statusCode).toBe(404);
    await app.close();
  });

  it('returns chunk detail', async () => {
    const deps = fakeDeps();
    vi.mocked(deps.chunks.get).mockResolvedValue({ id: 'c1' } as never);
    const app = buildApp(deps);

    const response = await app.inject({ method: 'GET', url: '/api/v1/chunks/c1' });

    expect(response.statusCode).toBe(200);
    await app.close();
  });
});
