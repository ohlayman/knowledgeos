import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type { McpAuditLog, McpToken } from '@kos/database';
import { buildApp } from '../../app.js';
import type { AppDeps } from '../../deps.js';

class FakeTokenRepository {
  tokens: McpToken[] = [];
  audits: Array<Record<string, unknown>> = [];
  dailyOverride?: number;

  async create(input: Record<string, unknown>): Promise<McpToken> {
    const token = {
      id: input.id,
      name: input.name,
      tokenHash: input.tokenHash,
      tokenPrefix: input.tokenPrefix,
      documentScope: input.documentScope ?? { mode: 'all' },
      toolAllowlist: input.toolAllowlist ?? [],
      dailyLimit: input.dailyLimit ?? 500,
      qpsLimit: input.qpsLimit ?? 5,
      expiresAt: input.expiresAt ?? null,
      revokedAt: null,
      lastUsedAt: null,
      createdAt: new Date(),
    } as unknown as McpToken;
    this.tokens.push(token);
    return token;
  }

  async list(): Promise<McpToken[]> {
    return this.tokens;
  }

  async findByHash(hash: string): Promise<McpToken | null> {
    return this.tokens.find((token) => token.tokenHash === hash) ?? null;
  }

  async findById(id: string): Promise<McpToken | null> {
    return this.tokens.find((token) => token.id === id) ?? null;
  }

  async revoke(id: string): Promise<McpToken> {
    const token = this.tokens.find((item) => item.id === id)!;
    token.revokedAt = new Date();
    return token;
  }

  async update(id: string, input: Record<string, unknown>): Promise<McpToken> {
    const token = this.tokens.find((item) => item.id === id)!;
    Object.assign(token, input);
    return token;
  }

  async touch(): Promise<void> {}

  async countToday(): Promise<number> {
    return this.dailyOverride ?? 0;
  }

  async countTodayByToken(): Promise<Map<string, number>> {
    return new Map();
  }

  async createAudit(input: Record<string, unknown>): Promise<McpAuditLog> {
    this.audits.push(input);
    return input as unknown as McpAuditLog;
  }

  async listAudits(): Promise<McpAuditLog[]> {
    return this.audits as unknown as McpAuditLog[];
  }

  async stats() {
    return { calls: 0, failures: 0, rateLimited: 0, avgLatencyMs: 0, byTool: [] };
  }
}

function fakeDeps(repo: FakeTokenRepository, retrieve = vi.fn()): AppDeps {
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
    db: { ping: vi.fn(), close: vi.fn() },
    redis: { ping: vi.fn(), close: vi.fn() },
    qdrant: { ping: vi.fn() },
    prisma: {
      chunk: { findMany: vi.fn().mockResolvedValue([]), findUnique: vi.fn() },
      document: { findMany: vi.fn().mockResolvedValue([]) },
    } as unknown as AppDeps['prisma'],
    storage: {} as AppDeps['storage'],
    queue: { close: vi.fn() },
    documents: {} as AppDeps['documents'],
    jobs: {} as AppDeps['jobs'],
    retrieval: { retrieve } as unknown as AppDeps['retrieval'],
    conversations: {} as AppDeps['conversations'],
    chunks: {} as AppDeps['chunks'],
    settings: {} as AppDeps['settings'],
    metrics: {} as AppDeps['metrics'],
    maintenance: {} as AppDeps['maintenance'],
    urlFetcher: {} as AppDeps['urlFetcher'],
    wiki: {} as AppDeps['wiki'],
    graph: {} as AppDeps['graph'],
    agents: {} as AppDeps['agents'],
    mcpTokens: repo as unknown as AppDeps['mcpTokens'],
    chatProvider: async () => {
      throw new Error('unused');
    },
  };
}

async function createToken(
  app: ReturnType<typeof buildApp>,
  overrides: Record<string, unknown> = {},
) {
  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/mcp-tokens',
    payload: { name: '测试令牌', ...overrides },
  });
  expect(response.statusCode).toBe(201);
  return response.json() as { id: string; token: string };
}

describe('mcp token routes', () => {
  it('returns the plaintext token only at creation', async () => {
    const repo = new FakeTokenRepository();
    const app = buildApp(fakeDeps(repo));

    const created = await createToken(app);
    expect(created.token.startsWith('kos_')).toBe(true);

    const list = await app.inject({ method: 'GET', url: '/api/v1/mcp-tokens' });
    const body = list.json() as Array<Record<string, unknown>>;
    expect(body[0]).not.toHaveProperty('token');
    expect(body[0]?.tokenPrefix).toBe(created.token.slice(0, 12));
  });

  it('rejects an empty scope before creating a token', async () => {
    const repo = new FakeTokenRepository();
    const app = buildApp(fakeDeps(repo));

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/mcp-tokens',
      payload: { name: '空标签', scope: { mode: 'tags', tags: [] } },
    });

    expect(response.statusCode).toBe(400);
    expect(repo.tokens).toHaveLength(0);
  });

  it('rejects calls without a bearer token', async () => {
    const repo = new FakeTokenRepository();
    const app = buildApp(fakeDeps(repo));

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/mcp/tools/search_knowledge',
      payload: { query: 'RRF' },
    });

    expect(response.statusCode).toBe(401);
  });

  it('hides tools outside the allowlist', async () => {
    const repo = new FakeTokenRepository();
    const app = buildApp(fakeDeps(repo));
    const created = await createToken(app, { tools: ['read_wiki'] });

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/mcp/tools/search_knowledge',
      headers: { authorization: `Bearer ${created.token}` },
      payload: { query: 'RRF' },
    });

    expect(response.statusCode).toBe(403);
  });

  it('pushes the tag scope into retrieval and audits without body text', async () => {
    const repo = new FakeTokenRepository();
    const retrieve = vi.fn().mockResolvedValue({
      evidence: [
        {
          chunkId: randomUUID(),
          documentId: randomUUID(),
          versionId: randomUUID(),
          text: 'RRF 是一种融合排序方法。',
          score: 0.9,
          headingPath: ['检索'],
        },
      ],
      noEvidence: false,
      trace: { questionType: 'fact', vectorHits: 1, keywordHits: 1, degraded: [] },
    });
    const app = buildApp(fakeDeps(repo, retrieve));
    const created = await createToken(app, {
      scope: { mode: 'tags', tags: ['MCP'] },
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/mcp/tools/search_knowledge',
      headers: { authorization: `Bearer ${created.token}` },
      payload: { query: 'RRF', topK: 5 },
    });

    expect(response.statusCode).toBe(200);
    expect(retrieve).toHaveBeenCalledWith('RRF', { finalTopK: 5, tags: ['MCP'] });
    const body = response.json() as { items: unknown[]; scope: { mode: string } };
    expect(body.items).toHaveLength(1);
    expect(body.scope.mode).toBe('tags');

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(repo.audits).toHaveLength(1);
    expect(repo.audits[0]).toMatchObject({ tool: 'search_knowledge', resultCount: 1 });
    expect(JSON.stringify(repo.audits[0]?.paramsSummary)).not.toContain('融合排序');
    expect(repo.audits[0]?.paramsSummary).toMatchObject({
      pushedFilters: { tags: ['MCP'] },
    });
  });

  it('returns an empty list with a reason when the request scope does not intersect', async () => {
    const repo = new FakeTokenRepository();
    const retrieve = vi.fn();
    const app = buildApp(fakeDeps(repo, retrieve));
    const created = await createToken(app, { scope: { mode: 'tags', tags: ['MCP'] } });

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/mcp/tools/search_knowledge',
      headers: { authorization: `Bearer ${created.token}` },
      payload: { query: 'RRF', scope: { tags: ['Wiki'] } },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ items: [], reason: 'scope_empty' });
    expect(retrieve).not.toHaveBeenCalled();
  });

  it('limits each token to its configured qps', async () => {
    const repo = new FakeTokenRepository();
    const retrieve = vi.fn().mockResolvedValue({
      evidence: [],
      noEvidence: true,
      trace: { questionType: 'open', vectorHits: 0, keywordHits: 0, degraded: [] },
    });
    const app = buildApp(fakeDeps(repo, retrieve));
    const created = await createToken(app, { qpsLimit: 1 });

    const first = await app.inject({
      method: 'POST',
      url: '/api/v1/mcp/tools/search_knowledge',
      headers: { authorization: `Bearer ${created.token}` },
      payload: { query: 'RRF' },
    });
    const second = await app.inject({
      method: 'POST',
      url: '/api/v1/mcp/tools/search_knowledge',
      headers: { authorization: `Bearer ${created.token}` },
      payload: { query: 'RRF' },
    });

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(429);
    expect(second.json()).toMatchObject({
      error: { details: { retryAfterMs: expect.any(Number) } },
    });
  });

  it('rejects calls after the daily limit with a recovery time', async () => {
    const repo = new FakeTokenRepository();
    const app = buildApp(fakeDeps(repo));
    const created = await createToken(app, { dailyLimit: 1 });
    repo.dailyOverride = 1;

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/mcp/tools/search_knowledge',
      headers: { authorization: `Bearer ${created.token}` },
      payload: { query: 'RRF' },
    });

    expect(response.statusCode).toBe(429);
    expect(response.json().error.message).toContain('次日 00:00');
    expect(response.json().error.details.resetsAt).toEqual(expect.any(String));
  });

  it('returns an example when the parameters are invalid', async () => {
    const repo = new FakeTokenRepository();
    const app = buildApp(fakeDeps(repo));
    const created = await createToken(app);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/mcp/tools/search_knowledge',
      headers: { authorization: `Bearer ${created.token}` },
      payload: { query: '' },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.message).toContain('合法示例');
  });

  it('fails immediately after the token is revoked', async () => {
    const repo = new FakeTokenRepository();
    const app = buildApp(fakeDeps(repo));
    const created = await createToken(app);

    await app.inject({ method: 'DELETE', url: `/api/v1/mcp-tokens/${created.id}` });
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/mcp/tools/search_knowledge',
      headers: { authorization: `Bearer ${created.token}` },
      payload: { query: 'RRF' },
    });

    expect(response.statusCode).toBe(401);
  });
});
