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
    conversations: {} as AppDeps['conversations'],
    settings: {} as AppDeps['settings'],
    metrics: {} as AppDeps['metrics'],
    retrieval: {} as AppDeps['retrieval'],
    jobs: {
      list: vi.fn(),
      get: vi.fn(),
      retry: vi.fn(),
      cancel: vi.fn(),
    } as unknown as AppDeps['jobs'],
    chunks: {} as AppDeps['chunks'],
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

describe('job routes', () => {
  it('lists jobs with status and cursor', async () => {
    const deps = fakeDeps();
    vi.mocked(deps.jobs.list).mockResolvedValue({ items: [], nextCursor: null });
    const app = buildApp(deps);

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/jobs?status=failed&limit=5',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ items: [], nextCursor: null });
    expect(deps.jobs.list).toHaveBeenCalledWith({ status: 'failed', limit: 5 });
    await app.close();
  });

  it('returns job detail with steps', async () => {
    const deps = fakeDeps();
    vi.mocked(deps.jobs.get).mockResolvedValue({ id: 'job-1', steps: [] } as never);
    const app = buildApp(deps);

    const response = await app.inject({ method: 'GET', url: '/api/v1/jobs/job-1' });

    expect(response.statusCode).toBe(200);
    expect(response.json().id).toBe('job-1');
    await app.close();
  });

  it('returns 404 for a missing job', async () => {
    const deps = fakeDeps();
    vi.mocked(deps.jobs.get).mockRejectedValue(new ApiError('NOT_FOUND'));
    const app = buildApp(deps);

    const response = await app.inject({ method: 'GET', url: '/api/v1/jobs/missing' });

    expect(response.statusCode).toBe(404);
    await app.close();
  });

  it('retries a single step', async () => {
    const deps = fakeDeps();
    vi.mocked(deps.jobs.retry).mockResolvedValue({ id: 'job-1', status: 'queued' } as never);
    const app = buildApp(deps);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/jobs/job-1/retry',
      payload: { mode: 'step', step: 'embed' },
    });

    expect(response.statusCode).toBe(202);
    expect(deps.jobs.retry).toHaveBeenCalledWith('job-1', { mode: 'step', step: 'embed' });
    await app.close();
  });

  it('rejects a step retry without a step name', async () => {
    const deps = fakeDeps();
    const app = buildApp(deps);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/jobs/job-1/retry',
      payload: { mode: 'step' },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('INVALID_ARGUMENT');
    await app.close();
  });

  it('cancels a running job', async () => {
    const deps = fakeDeps();
    vi.mocked(deps.jobs.cancel).mockResolvedValue(undefined);
    const app = buildApp(deps);

    const response = await app.inject({ method: 'POST', url: '/api/v1/jobs/job-1/cancel' });

    expect(response.statusCode).toBe(204);
    expect(deps.jobs.cancel).toHaveBeenCalledWith('job-1');
    await app.close();
  });
});
