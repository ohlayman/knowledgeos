import { randomUUID } from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import type { McpToken } from '@kos/database';
import { ApiError, sha256Hex, type McpDocumentScope, type McpToolName } from '@kos/shared';
import type { AppDeps } from '../../deps.js';
import { ScopeGuard } from './scope.js';

export interface McpContext {
  token: McpToken;
  guard: ScopeGuard;
  tool: McpToolName;
  transport: string;
  startedAt: number;
  summary: Record<string, unknown>;
  resultCount?: number;
  suspicious?: boolean;
}

interface QpsBucket {
  windowStart: number;
  count: number;
}

const qpsBuckets = new Map<string, QpsBucket>();
const TOKEN_PREFIX = 'kos_';

export function generateToken(): { token: string; prefix: string; hash: string } {
  const token = `${TOKEN_PREFIX}${randomUUID().replace(/-/g, '')}${randomUUID().replace(/-/g, '')}`;
  return {
    token,
    prefix: token.slice(0, 12),
    hash: sha256Hex(token),
  };
}

export function startOfLocalDay(now = new Date()): Date {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

function nextLocalDay(now = new Date()): Date {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
}

function checkQps(token: McpToken): void {
  const now = Date.now();
  const windowStart = Math.floor(now / 1000) * 1000;
  const bucket = qpsBuckets.get(token.id);

  if (!bucket || bucket.windowStart !== windowStart) {
    qpsBuckets.set(token.id, { windowStart, count: 1 });
    return;
  }

  if (bucket.count >= token.qpsLimit) {
    throw new ApiError('RATE_LIMITED', 'MCP 调用过于频繁，请稍后重试', {
      retryAfterMs: windowStart + 1000 - now,
    });
  }

  bucket.count += 1;
}

async function checkDailyLimit(deps: AppDeps, token: McpToken): Promise<void> {
  const used = await deps.mcpTokens.countToday(token.id, startOfLocalDay());
  if (used >= token.dailyLimit) {
    throw new ApiError('RATE_LIMITED', '今日 MCP 调用额度已用完，次日 00:00 恢复', {
      resetsAt: nextLocalDay().toISOString(),
    });
  }
}

function bearerToken(request: FastifyRequest): string {
  const header = request.headers.authorization;
  const token = header?.startsWith('Bearer ') ? header.slice('Bearer '.length).trim() : '';
  if (!token.startsWith(TOKEN_PREFIX)) {
    throw new ApiError('UNAUTHORIZED', 'MCP 令牌无效或已过期，请重新配置接入令牌');
  }
  return token;
}

export async function authenticateMcp(
  deps: AppDeps,
  request: FastifyRequest,
  tool: McpToolName,
): Promise<McpContext> {
  const startedAt = Date.now();
  const token = await deps.mcpTokens.findByHash(sha256Hex(bearerToken(request)));

  if (!token || token.revokedAt || (token.expiresAt && token.expiresAt.getTime() <= Date.now())) {
    throw new ApiError('UNAUTHORIZED', 'MCP 令牌无效或已过期，请重新配置接入令牌');
  }

  if (!token.toolAllowlist.includes(tool)) {
    throw new ApiError('FORBIDDEN_SCOPE', '当前令牌无权执行该操作');
  }

  checkQps(token);
  await checkDailyLimit(deps, token);

  const scope = (token.documentScope ?? { mode: 'all' }) as McpDocumentScope;
  const transportHeader = request.headers['x-kos-mcp-transport'];
  const transport = typeof transportHeader === 'string' ? transportHeader : 'http';

  return {
    token,
    guard: new ScopeGuard(deps.prisma, scope),
    tool,
    transport,
    startedAt,
    summary: {},
  };
}

export async function writeAudit(
  deps: AppDeps,
  context: McpContext | undefined,
  statusCode: number,
): Promise<void> {
  if (!context) {
    return;
  }
  try {
    await deps.mcpTokens.createAudit({
      id: randomUUID(),
      tokenId: context.token.id,
      tool: context.tool,
      paramsSummary: context.summary as never,
      ...(context.resultCount === undefined ? {} : { resultCount: context.resultCount }),
      durationMs: Date.now() - context.startedAt,
      statusCode,
      transport: context.transport,
      suspicious: context.suspicious ?? false,
    });
    await deps.mcpTokens.touch(context.token.id);
  } catch (error) {
    // 审计失败不能让工具调用失败；记录到服务日志即可。
    console.error('failed to write mcp audit', error);
  }
}
