import { Prisma, type PrismaClient } from '@prisma/client';
import type { EntryNode, GraphEdge, GraphNode, GraphStore } from '@kos/graph';

interface DegreeRow {
  id: string;
  canonical_name: string;
  type: string;
  aliases: string[];
  mention_count: number;
  confidence: number;
  merged_into_id: string | null;
  degree: bigint | number;
}

function toNode(row: {
  id: string;
  canonicalName: string;
  type: string;
  aliases: string[];
  mentionCount: number;
  confidence: number;
  mergedIntoId: string | null;
}): GraphNode {
  return {
    id: row.id,
    name: row.canonicalName,
    type: row.type,
    aliases: row.aliases,
    mentionCount: row.mentionCount,
    confidence: row.confidence,
    mergedIntoId: row.mergedIntoId,
  };
}

function toEdge(row: {
  id: string;
  fromEntityId: string;
  toEntityId: string;
  type: string;
  confidence: number;
  evidenceChunkIds: string[];
  status: string;
  origin: string;
  direction: string;
}): GraphEdge {
  return {
    id: row.id,
    fromId: row.fromEntityId,
    toId: row.toEntityId,
    type: row.type,
    confidence: row.confidence,
    evidenceChunkIds: row.evidenceChunkIds,
    status: row.status,
    origin: row.origin,
    direction: row.direction,
  };
}

export class PrismaGraphStore implements GraphStore {
  constructor(private readonly prisma: PrismaClient) {}

  async getEntities(ids: string[]): Promise<GraphNode[]> {
    if (ids.length === 0) {
      return [];
    }
    const rows = await this.prisma.entity.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        canonicalName: true,
        type: true,
        aliases: true,
        mentionCount: true,
        confidence: true,
        mergedIntoId: true,
      },
    });
    return rows.map(toNode);
  }

  async resolveMergedMap(): Promise<Map<string, string>> {
    const rows = await this.prisma.entity.findMany({
      where: { status: 'merged', mergedIntoId: { not: null } },
      select: { id: true, mergedIntoId: true },
    });
    return new Map(rows.flatMap((row) => (row.mergedIntoId ? [[row.id, row.mergedIntoId]] : [])));
  }

  async listRelations(entityIds: string[]): Promise<GraphEdge[]> {
    if (entityIds.length === 0) {
      return [];
    }
    const rows = await this.prisma.relation.findMany({
      where: {
        status: { in: ['active', 'pending'] },
        OR: [{ fromEntityId: { in: entityIds } }, { toEntityId: { in: entityIds } }],
      },
      select: {
        id: true,
        fromEntityId: true,
        toEntityId: true,
        type: true,
        confidence: true,
        evidenceChunkIds: true,
        status: true,
        origin: true,
        direction: true,
      },
    });
    return rows.map(toEdge);
  }

  async listEntryNodes(limit: number): Promise<EntryNode[]> {
    const rows = await this.prisma.$queryRaw<DegreeRow[]>(Prisma.sql`
      SELECT e.id,
             e.canonical_name,
             e.type::text AS type,
             e.aliases,
             e.mention_count,
             e.confidence,
             e.merged_into_id,
             COUNT(r.id)::int AS degree
      FROM entities e
      LEFT JOIN relations r
        ON r.status = 'active'
       AND (r.from_entity_id = e.id OR r.to_entity_id = e.id)
      WHERE e.status = 'active'
      GROUP BY e.id
      ORDER BY degree DESC, e.mention_count DESC, e.canonical_name ASC
      LIMIT ${limit}
    `);

    return rows.map((row) => ({
      node: toNode({
        id: row.id,
        canonicalName: row.canonical_name,
        type: row.type,
        aliases: row.aliases,
        mentionCount: row.mention_count,
        confidence: row.confidence,
        mergedIntoId: row.merged_into_id,
      }),
      degree: Number(row.degree),
    }));
  }

  async listPendingRelations(limit: number): Promise<GraphEdge[]> {
    const rows = await this.prisma.relation.findMany({
      where: { status: 'pending' },
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: {
        id: true,
        fromEntityId: true,
        toEntityId: true,
        type: true,
        confidence: true,
        evidenceChunkIds: true,
        status: true,
        origin: true,
        direction: true,
      },
    });
    return rows.map(toEdge);
  }

  async confirmRelation(id: string): Promise<GraphEdge> {
    const row = await this.prisma.relation.update({
      where: { id },
      data: { status: 'active', origin: 'human' },
      select: {
        id: true,
        fromEntityId: true,
        toEntityId: true,
        type: true,
        confidence: true,
        evidenceChunkIds: true,
        status: true,
        origin: true,
        direction: true,
      },
    });
    return toEdge(row);
  }

  async mergeEntity(sourceId: string, targetId: string): Promise<void> {
    await this.prisma.entity.update({
      where: { id: sourceId },
      data: { status: 'merged', mergedIntoId: targetId },
    });
  }

  async undoMerge(sourceId: string): Promise<void> {
    await this.prisma.entity.update({
      where: { id: sourceId },
      data: { status: 'active', mergedIntoId: null },
    });
  }
}
