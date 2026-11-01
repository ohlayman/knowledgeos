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
    metrics: {} as AppDeps['metrics'],
    settings: {
      overview: vi.fn(),
      update: vi.fn(),
      saveProvider: vi.fn(),
      testConnection: vi.fn(),
    } as unknown as AppDeps['settings'],
    chunks: {} as AppDeps['chunks'],
    maintenance: {} as AppDeps['maintenance'],
    urlFetcher: { fetch: vi.fn() },
    wiki: {} as AppDeps['wiki'],
    graph: {} as AppDeps['graph'],
    agents: {} as AppDeps['agents'],
  } as AppDeps;
}

const overview = {
  settings: { 'retrieval.topK': 10 },
  providers: [],
  runtime: {
    chat: { model: 'fake-chat', source: 'fake' as const },
    embedding: { model: 'text-embedding-3-small', dim: 1536, source: 'fake' as const },
  },
};

describe('settings routes', () => {
  it('returns settings without secrets', async () => {
    const deps = fakeDeps();
    vi.mocked(deps.settings.overview).mockResolvedValue(overview);
    const app = buildApp(deps);

    const response = await app.inject({ method: 'GET', url: '/api/v1/settings' });

    expect(response.statusCode).toBe(200);
    expect(response.body).not.toContain('apiKeyEncrypted');
    await app.close();
  });

  it('rejects settings outside the allow list', async () => {
    const deps = fakeDeps();
    const app = buildApp(deps);

    const response = await app.inject({
      method: 'PUT',
      url: '/api/v1/settings',
      payload: { settings: { 'database.url': 'postgres://evil' } },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('INVALID_ARGUMENT');
    await app.close();
  });

  it('updates allowed settings', async () => {
    const deps = fakeDeps();
    vi.mocked(deps.settings.update).mockResolvedValue(overview);
    const app = buildApp(deps);

    const response = await app.inject({
      method: 'PUT',
      url: '/api/v1/settings',
      payload: { settings: { 'retrieval.topK': 12 } },
    });

    expect(response.statusCode).toBe(200);
    expect(deps.settings.update).toHaveBeenCalledWith({ settings: { 'retrieval.topK': 12 } });
    await app.close();
  });

  it('rejects rerank provider configuration', async () => {
    const deps = fakeDeps();
    const app = buildApp(deps);

    const response = await app.inject({
      method: 'PUT',
      url: '/api/v1/settings/providers/rerank',
      payload: { provider: 'openai', model: 'x' },
    });

    expect(response.statusCode).toBe(400);
    await app.close();
  });

  it('saves a provider config', async () => {
    const deps = fakeDeps();
    vi.mocked(deps.settings.saveProvider).mockResolvedValue(overview);
    const app = buildApp(deps);

    const response = await app.inject({
      method: 'PUT',
      url: '/api/v1/settings/providers/llm',
      payload: { provider: 'openai', model: 'test-model', apiKey: 'sk-1234' },
    });

    expect(response.statusCode).toBe(200);
    expect(deps.settings.saveProvider).toHaveBeenCalledWith('llm', {
      provider: 'openai',
      model: 'test-model',
      apiKey: 'sk-1234',
    });
    await app.close();
  });

  it('reports connection test failures without leaking the response body', async () => {
    const deps = fakeDeps();
    vi.mocked(deps.settings.testConnection).mockResolvedValue({
      ok: false,
      code: 'INVALID_ARGUMENT',
      message: 'embedding 请求失败: HTTP 401',
      latencyMs: 10,
    });
    const app = buildApp(deps);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/settings/test-connection',
      payload: { kind: 'embedding' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ ok: false, code: 'INVALID_ARGUMENT' });
    await app.close();
  });
});
