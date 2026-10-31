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
    chunks: {} as AppDeps['chunks'],
    maintenance: {
      exportBundle: vi.fn().mockResolvedValue(Buffer.from('zip')),
      clear: vi.fn(),
    } as unknown as AppDeps['maintenance'],
    urlFetcher: { fetch: vi.fn() },
  } as AppDeps;
}

describe('maintenance routes', () => {
  it('streams an export zip', async () => {
    const deps = fakeDeps();
    const app = buildApp(deps);

    const response = await app.inject({ method: 'GET', url: '/api/v1/export' });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('application/zip');
    expect(response.headers['content-disposition']).toContain('attachment');
    await app.close();
  });

  it('requires the DELETE confirmation word', async () => {
    const deps = fakeDeps();
    const app = buildApp(deps);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/maintenance/clear',
      payload: { confirm: 'delete' },
    });

    expect(response.statusCode).toBe(400);
    expect(deps.maintenance.clear).not.toHaveBeenCalled();
    await app.close();
  });

  it('clears the knowledge base on confirmation', async () => {
    const deps = fakeDeps();
    vi.mocked(deps.maintenance.clear).mockResolvedValue({
      documents: 2,
      versions: 2,
      objectsDeleted: 2,
    });
    const app = buildApp(deps);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/maintenance/clear',
      payload: { confirm: 'DELETE' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ documents: 2, versions: 2, objectsDeleted: 2 });
    await app.close();
  });
});
