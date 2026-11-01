import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyPluginAsync, FastifyRequest } from 'fastify';
import type { z } from 'zod';
import type { McpToken } from '@kos/database';
import {
  ApiError,
  AskKnowledgeInputSchema,
  CreateMcpTokenSchema,
  DEFAULT_MCP_TOOL_ALLOWLIST,
  GetKnowledgeSourcesInputSchema,
  GetRelatedKnowledgeInputSchema,
  ProposeKnowledgeUpdateInputSchema,
  ReadWikiInputSchema,
  SearchKnowledgeInputSchema,
  UpdateMcpTokenSchema,
  isScopeEmpty,
  resolveTokenScope,
  scopeSummary,
  type McpDocumentScope,
  type McpToolName,
} from '@kos/shared';
import type { AppDeps } from '../../deps.js';
import {
  authenticateMcp,
  generateToken,
  startOfLocalDay,
  writeAudit,
  type McpContext,
} from './auth.js';
import { McpService } from './mcp-service.js';

const EXAMPLES: Record<McpToolName, unknown> = {
  search_knowledge: { query: 'RRF 融合', topK: 5 },
  read_wiki: { slug: 'rrf-fusion' },
  get_related_knowledge: { entityId: '00000000-0000-4000-8000-000000000000', hops: 1 },
  get_knowledge_sources: { chunkId: '00000000-0000-4000-8000-000000000000' },
  ask_knowledge: { question: '什么是 RRF 融合？' },
  propose_knowledge_update: {
    pageId: '00000000-0000-4000-8000-000000000000',
    summary: '补充 RRF 的 k 值取值建议',
    evidenceChunkIds: ['00000000-0000-4000-8000-000000000000'],
  },
};

function tokenScope(token: McpToken): McpDocumentScope {
  return (token.documentScope ?? { mode: 'all' }) as McpDocumentScope;
}

function tokenStatus(token: McpToken): 'active' | 'expired' | 'revoked' {
  if (token.revokedAt) {
    return 'revoked';
  }
  if (token.expiresAt && token.expiresAt.getTime() <= Date.now()) {
    return 'expired';
  }
  return 'active';
}

function serializeToken(token: McpToken, todayCalls: number) {
  const scope = tokenScope(token);
  return {
    id: token.id,
    name: token.name,
    tokenPrefix: token.tokenPrefix,
    scope,
    scopeSummary: scopeSummary(scope),
    tools: token.toolAllowlist,
    dailyLimit: token.dailyLimit,
    qpsLimit: token.qpsLimit,
    expiresAt: token.expiresAt?.toISOString() ?? null,
    revokedAt: token.revokedAt?.toISOString() ?? null,
    lastUsedAt: token.lastUsedAt?.toISOString() ?? null,
    createdAt: token.createdAt.toISOString(),
    todayCalls,
    status: tokenStatus(token),
  };
}

function parseJsonScope(input: unknown): McpDocumentScope {
  return input as McpDocumentScope;
}

export const mcpRoutes: FastifyPluginAsync<{ deps: AppDeps }> = async (app, opts) => {
  const service = new McpService({
    prisma: opts.deps.prisma,
    retrieval: opts.deps.retrieval,
    graph: opts.deps.graph,
    wiki: opts.deps.wiki,
    chatProvider: opts.deps.chatProvider,
  });

  app.post('/api/v1/mcp-tokens', async (request, reply) => {
    const parsed = CreateMcpTokenSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new ApiError('INVALID_ARGUMENT', '令牌参数不合法');
    }
    const input = parsed.data;
    const scope = parseJsonScope(input.scope ?? { mode: 'all' });
    if (isScopeEmpty(scope)) {
      throw new ApiError('INVALID_ARGUMENT', '所选作用域没有可访问的文档，请先选择标签或文档');
    }

    const expiresInDays = input.expiresInDays === undefined ? 90 : input.expiresInDays;
    const { token, prefix, hash } = generateToken();
    const record = await opts.deps.mcpTokens.create({
      id: randomUUID(),
      name: input.name,
      tokenHash: hash,
      tokenPrefix: prefix,
      documentScope: scope as never,
      toolAllowlist: input.tools ?? [...DEFAULT_MCP_TOOL_ALLOWLIST],
      dailyLimit: input.dailyLimit ?? 500,
      qpsLimit: input.qpsLimit ?? 5,
      expiresAt:
        expiresInDays === null ? null : new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000),
    });

    // 明文只在这里出现一次，之后任何接口都不返回。
    return reply.status(201).send({ ...serializeToken(record, 0), token });
  });

  app.get('/api/v1/mcp-tokens', async () => {
    const [tokens, counts] = await Promise.all([
      opts.deps.mcpTokens.list(),
      opts.deps.mcpTokens.countTodayByToken(startOfLocalDay()),
    ]);
    return tokens.map((token) => serializeToken(token, counts.get(token.id) ?? 0));
  });

  app.patch('/api/v1/mcp-tokens/:id', async (request) => {
    const { id } = request.params as { id: string };
    const parsed = UpdateMcpTokenSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new ApiError('INVALID_ARGUMENT', '令牌参数不合法');
    }
    if (parsed.data.scope && isScopeEmpty(parsed.data.scope)) {
      throw new ApiError('INVALID_ARGUMENT', '所选作用域没有可访问的文档，请先选择标签或文档');
    }
    const existing = await opts.deps.mcpTokens.findById(id);
    if (!existing) {
      throw new ApiError('NOT_FOUND', '令牌不存在');
    }
    const updated = await opts.deps.mcpTokens.update(id, {
      ...(parsed.data.name === undefined ? {} : { name: parsed.data.name }),
      ...(parsed.data.scope === undefined ? {} : { documentScope: parsed.data.scope as never }),
      ...(parsed.data.tools === undefined ? {} : { toolAllowlist: parsed.data.tools }),
      ...(parsed.data.dailyLimit === undefined ? {} : { dailyLimit: parsed.data.dailyLimit }),
      ...(parsed.data.qpsLimit === undefined ? {} : { qpsLimit: parsed.data.qpsLimit }),
    });
    return serializeToken(updated, 0);
  });

  app.delete('/api/v1/mcp-tokens/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const existing = await opts.deps.mcpTokens.findById(id);
    if (!existing) {
      throw new ApiError('NOT_FOUND', '令牌不存在');
    }
    await opts.deps.mcpTokens.revoke(id);
    return reply.status(204).send();
  });

  app.post('/api/v1/mcp-tokens/:id/test', async (request) => {
    const { id } = request.params as { id: string };
    const token = await opts.deps.mcpTokens.findById(id);
    if (!token || token.revokedAt) {
      return { ok: false, message: '连接失败：令牌无效或服务未启动' };
    }
    if (token.expiresAt && token.expiresAt.getTime() <= Date.now()) {
      return { ok: false, message: '连接失败：令牌已过期，请重新创建' };
    }

    const resolution = resolveTokenScope(tokenScope(token));
    if (!resolution.ok) {
      return {
        ok: false,
        message: '该令牌的作用域为空，无法检索到任何内容',
      };
    }

    const startedAt = Date.now();
    try {
      const result = await opts.deps.retrieval.retrieve('知识库', {
        finalTopK: 1,
        ...resolution.filter,
      });
      const latencyMs = Date.now() - startedAt;
      return {
        ok: true,
        latencyMs,
        resultCount: result.evidence.length,
        message: `连接正常，延迟 ${latencyMs}ms`,
      };
    } catch (error) {
      return {
        ok: false,
        message:
          error instanceof ApiError ? `连接失败：${error.message}` : '连接失败：检索服务不可用',
      };
    }
  });

  app.get('/api/v1/mcp-audit', async (request) => {
    const query = request.query as {
      tokenId?: string;
      tool?: string;
      status?: string;
      from?: string;
      to?: string;
      limit?: string;
    };
    const status =
      query.status === 'success' || query.status === 'failed' || query.status === 'rate_limited'
        ? query.status
        : undefined;
    const [tokens, rows] = await Promise.all([
      opts.deps.mcpTokens.list(),
      opts.deps.mcpTokens.listAudits({
        ...(query.tokenId ? { tokenId: query.tokenId } : {}),
        ...(query.tool ? { tool: query.tool } : {}),
        ...(status ? { status } : {}),
        ...(query.from ? { from: new Date(query.from) } : {}),
        ...(query.to ? { to: new Date(query.to) } : {}),
        ...(query.limit ? { limit: Number(query.limit) } : {}),
      }),
    ]);
    const names = new Map(tokens.map((token) => [token.id, token.name]));
    return rows.map((row) => ({
      id: row.id,
      tokenId: row.tokenId,
      tokenName: row.tokenId ? (names.get(row.tokenId) ?? '已删除令牌') : null,
      tool: row.tool,
      paramsSummary: row.paramsSummary,
      resultCount: row.resultCount,
      durationMs: row.durationMs,
      statusCode: row.statusCode,
      transport: row.transport,
      suspicious: row.suspicious,
      createdAt: row.createdAt.toISOString(),
    }));
  });

  app.get('/api/v1/mcp-audit/stats', async () => {
    return opts.deps.mcpTokens.stats(startOfLocalDay());
  });

  registerTool(app, opts.deps, service, 'search_knowledge', SearchKnowledgeInputSchema);
  registerTool(app, opts.deps, service, 'read_wiki', ReadWikiInputSchema);
  registerTool(app, opts.deps, service, 'get_related_knowledge', GetRelatedKnowledgeInputSchema);
  registerTool(app, opts.deps, service, 'get_knowledge_sources', GetKnowledgeSourcesInputSchema);
  registerTool(app, opts.deps, service, 'ask_knowledge', AskKnowledgeInputSchema);
  registerTool(
    app,
    opts.deps,
    service,
    'propose_knowledge_update',
    ProposeKnowledgeUpdateInputSchema,
  );
};

function registerTool<T extends z.ZodTypeAny>(
  app: FastifyInstance,
  deps: AppDeps,
  service: McpService,
  tool: McpToolName,
  schema: T,
): void {
  app.post(`/api/v1/mcp/tools/${tool}`, async (request: FastifyRequest, reply) => {
    let context: McpContext | undefined;
    try {
      context = await authenticateMcp(deps, request, tool);
      const parsed = schema.safeParse(request.body);
      if (!parsed.success) {
        context.summary = { validation: 'failed' };
        throw new ApiError(
          'INVALID_ARGUMENT',
          `参数不合法。合法示例：${JSON.stringify(EXAMPLES[tool])}`,
        );
      }

      const result = await executeTool(service, context, tool, parsed.data);
      const list = (result as { items?: unknown[] }).items;
      if (Array.isArray(list)) {
        context.resultCount = list.length;
      }
      void writeAudit(deps, context, 200);
      return reply.send(result);
    } catch (error) {
      if (context) {
        context.summary = {
          ...context.summary,
          ...(error instanceof ApiError ? { errorCode: error.code } : {}),
        };
      }
      void writeAudit(deps, context, error instanceof ApiError ? error.status : 500);
      throw error;
    }
  });
}

async function executeTool(
  service: McpService,
  context: McpContext,
  tool: McpToolName,
  input: unknown,
): Promise<unknown> {
  switch (tool) {
    case 'search_knowledge':
      return service.search(context, input as z.infer<typeof SearchKnowledgeInputSchema>);
    case 'read_wiki':
      return service.readWiki(context, input as z.infer<typeof ReadWikiInputSchema>);
    case 'get_related_knowledge':
      return service.related(context, input as z.infer<typeof GetRelatedKnowledgeInputSchema>);
    case 'get_knowledge_sources':
      return service.sources(context, input as z.infer<typeof GetKnowledgeSourcesInputSchema>);
    case 'ask_knowledge':
      return service.ask(context, input as z.infer<typeof AskKnowledgeInputSchema>);
    case 'propose_knowledge_update':
      return service.propose(context, input as z.infer<typeof ProposeKnowledgeUpdateInputSchema>);
  }
}
