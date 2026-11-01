import { describe, expect, it, vi } from 'vitest';
import { buildApp } from '../../app.js';
import type { AppDeps } from '../../deps.js';

function fakeDeps(wiki: Record<string, unknown>): AppDeps {
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
    wiki: wiki as unknown as AppDeps['wiki'],
  };
}

function appWith(wiki: Record<string, unknown>) {
  return buildApp(fakeDeps(wiki));
}

describe('wiki routes', () => {
  it('accepts a proposal with baseRevisionId', async () => {
    const acceptProposal = vi.fn().mockResolvedValue({ revisionId: 'r1', pageId: 'p1' });
    const app = appWith({ acceptProposal });
    const baseRevisionId = '11111111-1111-4111-8111-111111111111';

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/wiki/proposals/p1/accept',
      payload: { baseRevisionId },
    });

    expect(response.statusCode).toBe(200);
    expect(acceptProposal).toHaveBeenCalledWith('p1', baseRevisionId);
    await app.close();
  });

  it('requires a structured reject reason', async () => {
    const rejectProposal = vi.fn();
    const app = appWith({ rejectProposal });

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/wiki/proposals/p1/reject',
      payload: { comment: '没有选择原因' },
    });

    expect(response.statusCode).toBe(400);
    expect(rejectProposal).not.toHaveBeenCalled();
    await app.close();
  });

  it('passes the reject reason and comment to the service', async () => {
    const rejectProposal = vi.fn().mockResolvedValue({ id: 'p1', status: 'rejected' });
    const app = appWith({ rejectProposal });

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/wiki/proposals/p1/reject',
      payload: { reason: 'factual_error', comment: '数值不对' },
    });

    expect(response.statusCode).toBe(200);
    expect(rejectProposal).toHaveBeenCalledWith('p1', 'factual_error', '数值不对');
    await app.close();
  });

  it('validates page slug characters', async () => {
    const createPage = vi.fn();
    const app = appWith({ createPage });

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/wiki/pages',
      payload: { title: '页面', type: 'concept', slug: 'bad slug!' },
    });

    expect(response.statusCode).toBe(400);
    expect(createPage).not.toHaveBeenCalled();
    await app.close();
  });
});
