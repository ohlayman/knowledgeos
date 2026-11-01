import type { PrismaClient } from '@kos/database';
import type { McpDocumentScope } from '@kos/shared';

/**
 * 令牌作用域的唯一执行点：所有工具在返回前都通过它判断文档可见性。
 * all 模式返回 null，表示不做文档过滤。
 */
export class ScopeGuard {
  private allowed: Promise<Set<string> | null> | null = null;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly scope: McpDocumentScope,
  ) {}

  private load(): Promise<Set<string> | null> {
    if (!this.allowed) {
      this.allowed = (async () => {
        if (this.scope.mode === 'all') {
          return null;
        }
        if (this.scope.mode === 'documents') {
          const ids = this.scope.documentIds ?? [];
          if (ids.length === 0) {
            return new Set<string>();
          }
          const rows = await this.prisma.document.findMany({
            where: { id: { in: ids }, isDeleted: false },
            select: { id: true },
          });
          return new Set(rows.map((row) => row.id));
        }

        const tags = this.scope.tags ?? [];
        if (tags.length === 0) {
          return new Set<string>();
        }
        const rows = await this.prisma.document.findMany({
          where: { isDeleted: false, tags: { hasSome: tags } },
          select: { id: true },
        });
        return new Set(rows.map((row) => row.id));
      })();
    }
    return this.allowed;
  }

  async canAccessDocument(documentId: string): Promise<boolean> {
    const allowed = await this.load();
    return allowed === null || allowed.has(documentId);
  }

  async canAccessChunks(chunkIds: string[]): Promise<boolean> {
    if (chunkIds.length === 0) {
      return (await this.load()) === null;
    }
    const allowed = await this.load();
    if (allowed === null) {
      return true;
    }
    const rows = await this.prisma.chunk.findMany({
      where: { id: { in: chunkIds } },
      select: { id: true, documentId: true },
    });
    if (rows.length !== new Set(chunkIds).size) {
      return false;
    }
    return rows.every((row) => allowed.has(row.documentId));
  }
}
