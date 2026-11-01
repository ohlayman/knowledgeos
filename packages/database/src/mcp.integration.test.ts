import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { afterAll, describe, expect, it } from 'vitest';
import { McpTokenRepository } from './repositories/mcp.js';

const enabled = process.env.RUN_DB_INTEGRATION === '1';
const prisma = new PrismaClient();
const repo = new McpTokenRepository(prisma);
const tokenIds: string[] = [];

describe.skipIf(!enabled)('McpTokenRepository', () => {
  afterAll(async () => {
    await prisma.mcpAuditLog.deleteMany({ where: { tokenId: { in: tokenIds } } });
    await prisma.mcpToken.deleteMany({ where: { id: { in: tokenIds } } });
    await prisma.$disconnect();
  });

  it('stores hashed tokens, updates scope and records audits without body text', async () => {
    const id = randomUUID();
    tokenIds.push(id);
    const hash = randomUUID().replace(/-/g, '') + randomUUID().replace(/-/g, '');

    const created = await repo.create({
      id,
      name: '集成测试令牌',
      tokenHash: hash,
      tokenPrefix: 'kos_test0001',
      documentScope: { mode: 'tags', tags: ['MCP'] },
      toolAllowlist: ['search_knowledge'],
      dailyLimit: 10,
      qpsLimit: 2,
      expiresAt: null,
    });

    expect(created.tokenPrefix).toBe('kos_test0001');
    expect(await repo.findByHash(hash)).toMatchObject({ id, name: '集成测试令牌' });

    const updated = await repo.update(id, {
      documentScope: { mode: 'all' },
      toolAllowlist: ['search_knowledge', 'read_wiki'],
      dailyLimit: 20,
    });
    expect(updated.documentScope).toEqual({ mode: 'all' });
    expect(updated.toolAllowlist).toEqual(['search_knowledge', 'read_wiki']);
    expect(updated.dailyLimit).toBe(20);

    await repo.createAudit({
      id: randomUUID(),
      tokenId: id,
      tool: 'search_knowledge',
      paramsSummary: { query: 'RRF', pushedFilters: { tags: ['MCP'] } },
      resultCount: 3,
      durationMs: 42,
      statusCode: 200,
      transport: 'stdio',
    });
    await repo.createAudit({
      id: randomUUID(),
      tokenId: id,
      tool: 'search_knowledge',
      durationMs: 3,
      statusCode: 429,
      transport: 'stdio',
    });

    expect(await repo.countToday(id, new Date(Date.now() - 60_000))).toBe(2);
    const stats = await repo.stats(new Date(Date.now() - 60_000));
    expect(stats.calls).toBeGreaterThanOrEqual(2);
    expect(stats.rateLimited).toBeGreaterThanOrEqual(1);

    const audits = await repo.listAudits({ tokenId: id, status: 'success' });
    expect(audits).toHaveLength(1);
    expect(JSON.stringify(audits[0]?.paramsSummary)).not.toContain('"excerpt"');

    const revoked = await repo.revoke(id);
    expect(revoked.revokedAt).toBeInstanceOf(Date);
    await expect(
      repo.createAudit({
        id: randomUUID(),
        tokenId: id,
        tool: 'search_knowledge',
        durationMs: 1,
        statusCode: 401,
        transport: 'http',
      }),
    ).resolves.toBeTruthy();
  });
});
