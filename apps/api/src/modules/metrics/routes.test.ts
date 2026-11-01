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
    metrics: { overview: vi.fn() } as unknown as AppDeps['metrics'],
    chunks: {} as AppDeps['chunks'],
    maintenance: {} as AppDeps['maintenance'],
    urlFetcher: { fetch: vi.fn() },
    wiki: {} as AppDeps['wiki'],
  } as AppDeps;
}

describe('GET /api/v1/metrics/overview', () => {
  it('returns dashboard metrics', async () => {
    const deps = fakeDeps();
    vi.mocked(deps.metrics.overview).mockResolvedValue({
      documents: { total: 3, ready: 2, processing: 1, failed: 0 },
      chunks: { total: 10, vectorReady: 9 },
      storage: { bytes: 1024 },
      jobs: { queued: 1, running: 0, failed: 0 },
      queue: { waiting: 1, active: 0, failed: 0, completed: 3, backlog: 1, alert: false },
      health: { lastEvent: null },
      retrieval: { runs7d: 2, p95Ms: 42 },
      messages: { citationFailRate: null },
      recentDocuments: [],
      recentJobs: [],
    });
    const app = buildApp(deps);

    const response = await app.inject({ method: 'GET', url: '/api/v1/metrics/overview' });

    expect(response.statusCode).toBe(200);
    expect(response.json().documents.total).toBe(3);
    await app.close();
  });
});
