import { describe, expect, it, vi } from 'vitest';
import { buildApp } from '../../app.js';
import type { AppDeps } from '../../deps.js';

function fakeDeps(agents: Record<string, unknown>): AppDeps {
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
    chunks: {} as AppDeps['chunks'],
    settings: {} as AppDeps['settings'],
    metrics: {} as AppDeps['metrics'],
    maintenance: {} as AppDeps['maintenance'],
    urlFetcher: { fetch: vi.fn() },
    wiki: {} as AppDeps['wiki'],
    graph: {} as AppDeps['graph'],
    agents: agents as unknown as AppDeps['agents'],
    mcpTokens: {} as AppDeps['mcpTokens'],
    chatProvider: async () => {
      throw new Error('unused');
    },
  };
}

function appWith(agents: Record<string, unknown>) {
  return buildApp(fakeDeps(agents));
}

describe('agent routes', () => {
  it('validates agent config', async () => {
    const createAgent = vi.fn();
    const app = appWith({ createAgent });

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/agents',
      payload: { name: '缺少提示词' },
    });

    expect(response.statusCode).toBe(400);
    expect(createAgent).not.toHaveBeenCalled();
    await app.close();
  });

  it('triggers a run with the provided input', async () => {
    const trigger = vi.fn().mockResolvedValue({ id: 'run-1', status: 'queued' });
    const app = appWith({ trigger });

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/agents/a1/runs',
      payload: { input: '对比方案 A 与 B' },
    });

    expect(response.statusCode).toBe(202);
    expect(trigger).toHaveBeenCalledWith('a1', '对比方案 A 与 B');
    await app.close();
  });

  it('deletes a run through the service', async () => {
    const deleteRun = vi.fn().mockResolvedValue(undefined);
    const app = appWith({ deleteRun });

    const response = await app.inject({ method: 'DELETE', url: '/api/v1/agent-runs/run-1' });

    expect(response.statusCode).toBe(204);
    expect(deleteRun).toHaveBeenCalledWith('run-1');
    await app.close();
  });

  it('lists tools with parameter hints', async () => {
    const listTools = vi
      .fn()
      .mockReturnValue([
        { name: 'search_knowledge', kind: 'read', description: '检索', paramsHint: '{ query }' },
      ]);
    const app = appWith({ listTools });

    const response = await app.inject({ method: 'GET', url: '/api/v1/agents/tools' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toHaveLength(1);
    await app.close();
  });
});
