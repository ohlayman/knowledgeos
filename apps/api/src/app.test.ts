import { describe, expect, it, vi } from 'vitest';
import { buildApp } from './app.js';
import type { AppDeps } from './deps.js';

function fakeDeps(): AppDeps {
  return {
    env: {
      NODE_ENV: 'test' as const,
      HOST: '127.0.0.1',
      PORT: 3000,
      WEB_ORIGIN: 'http://localhost:5173',
      DATABASE_URL: 'postgresql://user:pass@localhost:5432/knowledgeos',
      REDIS_URL: 'redis://localhost:6379',
      QDRANT_URL: 'http://localhost:6333',
      DATA_DIR: './data',
      EMBEDDING_MODEL: 'text-embedding-3-small',
      EMBEDDING_DIM: 1536,
      LOG_LEVEL: 'fatal' as const,
    },
    db: {
      ping: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
    },
    redis: {
      ping: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
    },
    qdrant: {
      ping: vi.fn().mockResolvedValue(undefined),
    },
    prisma: {} as AppDeps['prisma'],
    storage: {} as AppDeps['storage'],
    queue: { close: vi.fn().mockResolvedValue(undefined) },
    documents: {
      ingestFile: vi.fn(),
      ingestText: vi.fn(),
      ingestUrl: vi.fn(),
    } as unknown as AppDeps['documents'],
    conversations: {} as AppDeps['conversations'],
    settings: {} as AppDeps['settings'],
    metrics: {} as AppDeps['metrics'],
    retrieval: {} as AppDeps['retrieval'],
    jobs: {} as AppDeps['jobs'],
    chunks: {} as AppDeps['chunks'],
    maintenance: {} as AppDeps['maintenance'],
    urlFetcher: { fetch: vi.fn() } as unknown as AppDeps['urlFetcher'],
    wiki: {} as AppDeps['wiki'],
  };
}

describe('health routes', () => {
  it('returns 200 on liveness', async () => {
    const app = buildApp(fakeDeps());

    const response = await app.inject({ method: 'GET', url: '/api/v1/health/live' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ status: 'ok' });
    await app.close();
  });

  it('returns 200 on readiness when all dependencies respond', async () => {
    const app = buildApp(fakeDeps());

    const response = await app.inject({ method: 'GET', url: '/api/v1/health/ready' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      status: 'ok',
      checks: { database: 'ok', redis: 'ok', qdrant: 'ok' },
    });
    await app.close();
  });

  it('returns 503 and names the failing dependency', async () => {
    const deps = fakeDeps();
    vi.mocked(deps.db.ping).mockRejectedValueOnce(new Error('database down'));
    const app = buildApp(deps);

    const response = await app.inject({ method: 'GET', url: '/api/v1/health/ready' });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({
      status: 'unavailable',
      failed: ['database'],
    });
    await app.close();
  });

  it('returns a request id and applies CORS/security headers', async () => {
    const app = buildApp(fakeDeps());

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/health/live',
      headers: { origin: 'http://localhost:5173' },
    });

    expect(response.headers['x-request-id']).toEqual(expect.any(String));
    expect(response.headers['access-control-allow-origin']).toBe('http://localhost:5173');
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    await app.close();
  });

  it('uses the error envelope for unknown routes', async () => {
    const app = buildApp(fakeDeps());

    const response = await app.inject({ method: 'GET', url: '/api/v1/unknown' });

    expect(response.statusCode).toBe(404);
    const body = response.json();
    expect(body).toEqual({
      error: {
        code: 'NOT_FOUND',
        message: expect.any(String),
        retryable: false,
        requestId: expect.any(String),
      },
    });
    expect(response.headers['x-request-id']).toBe(body.error.requestId);
    await app.close();
  });
});
