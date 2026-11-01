import type { McpAuditLog, McpToken, Prisma, PrismaClient } from '@prisma/client';

export interface CreateMcpTokenRecordInput {
  id: string;
  name: string;
  tokenHash: string;
  tokenPrefix: string;
  documentScope: Prisma.InputJsonValue;
  toolAllowlist: string[];
  dailyLimit: number;
  qpsLimit: number;
  expiresAt: Date | null;
}

export interface UpdateMcpTokenRecordInput {
  name?: string;
  documentScope?: Prisma.InputJsonValue;
  toolAllowlist?: string[];
  dailyLimit?: number;
  qpsLimit?: number;
}

export interface CreateMcpAuditInput {
  id: string;
  tokenId: string | null;
  tool: string;
  paramsSummary?: Prisma.InputJsonValue;
  resultCount?: number;
  durationMs: number;
  statusCode: number;
  transport: string;
  suspicious?: boolean;
}

export interface AuditFilter {
  tokenId?: string;
  tool?: string;
  status?: 'success' | 'failed' | 'rate_limited';
  from?: Date;
  to?: Date;
  limit?: number;
}

export interface AuditStats {
  calls: number;
  failures: number;
  rateLimited: number;
  avgLatencyMs: number;
  byTool: Array<{ tool: string; count: number }>;
}

export class McpTokenRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async create(input: CreateMcpTokenRecordInput): Promise<McpToken> {
    return this.prisma.mcpToken.create({
      data: {
        id: input.id,
        name: input.name,
        tokenHash: input.tokenHash,
        tokenPrefix: input.tokenPrefix,
        documentScope: input.documentScope,
        toolAllowlist: input.toolAllowlist,
        dailyLimit: input.dailyLimit,
        qpsLimit: input.qpsLimit,
        expiresAt: input.expiresAt,
      },
    });
  }

  async list(): Promise<McpToken[]> {
    return this.prisma.mcpToken.findMany({ orderBy: { createdAt: 'desc' } });
  }

  async findByHash(tokenHash: string): Promise<McpToken | null> {
    return this.prisma.mcpToken.findUnique({ where: { tokenHash } });
  }

  async findById(id: string): Promise<McpToken | null> {
    return this.prisma.mcpToken.findUnique({ where: { id } });
  }

  async revoke(id: string): Promise<McpToken> {
    return this.prisma.mcpToken.update({
      where: { id },
      data: { revokedAt: new Date() },
    });
  }

  async update(id: string, input: UpdateMcpTokenRecordInput): Promise<McpToken> {
    return this.prisma.mcpToken.update({
      where: { id },
      data: {
        ...(input.name === undefined ? {} : { name: input.name }),
        ...(input.documentScope === undefined ? {} : { documentScope: input.documentScope }),
        ...(input.toolAllowlist === undefined ? {} : { toolAllowlist: input.toolAllowlist }),
        ...(input.dailyLimit === undefined ? {} : { dailyLimit: input.dailyLimit }),
        ...(input.qpsLimit === undefined ? {} : { qpsLimit: input.qpsLimit }),
      },
    });
  }

  async touch(id: string): Promise<void> {
    await this.prisma.mcpToken.update({
      where: { id },
      data: { lastUsedAt: new Date() },
    });
  }

  async countToday(tokenId: string, since: Date): Promise<number> {
    return this.prisma.mcpAuditLog.count({
      where: { tokenId, createdAt: { gte: since } },
    });
  }

  async countTodayByToken(since: Date): Promise<Map<string, number>> {
    const rows = await this.prisma.mcpAuditLog.groupBy({
      by: ['tokenId'],
      where: { tokenId: { not: null }, createdAt: { gte: since } },
      _count: { _all: true },
    });
    const counts = new Map<string, number>();
    for (const row of rows) {
      if (row.tokenId) {
        counts.set(row.tokenId, row._count._all);
      }
    }
    return counts;
  }

  async createAudit(input: CreateMcpAuditInput): Promise<McpAuditLog> {
    return this.prisma.mcpAuditLog.create({
      data: {
        id: input.id,
        tokenId: input.tokenId,
        tool: input.tool,
        paramsSummary: input.paramsSummary,
        resultCount: input.resultCount ?? null,
        durationMs: input.durationMs,
        statusCode: input.statusCode,
        transport: input.transport,
        suspicious: input.suspicious ?? false,
      },
    });
  }

  async listAudits(filter: AuditFilter = {}): Promise<McpAuditLog[]> {
    const where: Prisma.McpAuditLogWhereInput = {
      ...(filter.tokenId ? { tokenId: filter.tokenId } : {}),
      ...(filter.tool ? { tool: filter.tool } : {}),
      ...(filter.from || filter.to
        ? {
            createdAt: {
              ...(filter.from ? { gte: filter.from } : {}),
              ...(filter.to ? { lte: filter.to } : {}),
            },
          }
        : {}),
    };

    if (filter.status === 'success') {
      where.statusCode = { gte: 200, lt: 300 };
    } else if (filter.status === 'failed') {
      where.statusCode = { gte: 400, notIn: [429] };
    } else if (filter.status === 'rate_limited') {
      where.statusCode = 429;
    }

    return this.prisma.mcpAuditLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: Math.min(Math.max(filter.limit ?? 100, 1), 500),
    });
  }

  async stats(since: Date): Promise<AuditStats> {
    const rows = await this.prisma.mcpAuditLog.findMany({
      where: { createdAt: { gte: since } },
      select: { tool: true, statusCode: true, durationMs: true },
    });

    const byTool = new Map<string, number>();
    let failures = 0;
    let rateLimited = 0;
    let totalDuration = 0;

    for (const row of rows) {
      byTool.set(row.tool, (byTool.get(row.tool) ?? 0) + 1);
      totalDuration += row.durationMs;
      if (row.statusCode === 429) {
        rateLimited += 1;
      } else if (row.statusCode >= 400) {
        failures += 1;
      }
    }

    return {
      calls: rows.length,
      failures,
      rateLimited,
      avgLatencyMs: rows.length ? Math.round(totalDuration / rows.length) : 0,
      byTool: [...byTool.entries()]
        .map(([tool, count]) => ({ tool, count }))
        .sort((a, b) => b.count - a.count),
    };
  }
}
