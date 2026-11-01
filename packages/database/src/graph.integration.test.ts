import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { GraphService } from '@kos/graph';
import { afterAll, describe, expect, it } from 'vitest';
import { PrismaGraphStore } from './repositories/graph.js';

const enabled = process.env.RUN_DB_INTEGRATION === '1';
const prisma = new PrismaClient();
const store = new PrismaGraphStore(prisma);
const service = new GraphService(store);
const suffix = randomUUID().slice(0, 8);
const entityIds: string[] = [];

async function createEntity(name: string, type: 'concept' | 'technology' = 'concept') {
  const entity = await prisma.entity.create({
    data: {
      id: randomUUID(),
      canonicalName: `${name}-${suffix}`,
      normalizedName: `${name}-${suffix}`.toLowerCase(),
      type,
      sourceChunkIds: [randomUUID()],
      mentionCount: 1,
      confidence: 0.8,
    },
  });
  entityIds.push(entity.id);
  return entity;
}

describe.skipIf(!enabled)('PrismaGraphStore', () => {
  afterAll(async () => {
    await prisma.entity.deleteMany({ where: { id: { in: entityIds } } });
    await prisma.$disconnect();
  });

  it('queries neighborhoods, paths, entry nodes and pending relations', async () => {
    const a = await createEntity('Qdrant', 'technology');
    const b = await createEntity('稀疏向量');
    const c = await createEntity('混合检索');
    const pending = await createEntity('弱关系');

    await prisma.relation.createMany({
      data: [
        {
          id: randomUUID(),
          fromEntityId: a.id,
          toEntityId: b.id,
          type: 'USES',
          evidenceChunkIds: [randomUUID()],
          confidence: 0.9,
          status: 'active',
        },
        {
          id: randomUUID(),
          fromEntityId: b.id,
          toEntityId: c.id,
          type: 'PART_OF',
          evidenceChunkIds: [randomUUID()],
          confidence: 0.85,
          status: 'active',
        },
        {
          id: randomUUID(),
          fromEntityId: a.id,
          toEntityId: pending.id,
          type: 'RELATED_TO',
          evidenceChunkIds: [randomUUID()],
          confidence: 0.5,
          status: 'pending',
        },
      ],
    });

    const oneHop = await service.neighborhood(a.id, 1);
    expect(oneHop.nodes.map((node) => node.id).sort()).toEqual([a.id, b.id].sort());

    const twoHops = await service.neighborhood(a.id, 2);
    expect(twoHops.nodes.some((node) => node.id === c.id)).toBe(true);

    const paths = await service.paths(a.id, c.id, 3);
    expect(paths[0]?.nodeIds).toEqual([a.id, b.id, c.id]);
    expect(paths[0]?.chunkIds.length).toBeGreaterThan(0);

    const entry = await service.entry(20);
    expect(entry[0]?.degree).toBeGreaterThanOrEqual(entry.at(-1)?.degree ?? 0);

    const pendingList = await service.pendingRelations();
    expect(pendingList.some((relation) => relation.toId === pending.id)).toBe(true);
  });

  it('confirms pending relations and supports merge/undo', async () => {
    const a = await createEntity('MergeA');
    const b = await createEntity('MergeB');
    const relation = await prisma.relation.create({
      data: {
        id: randomUUID(),
        fromEntityId: a.id,
        toEntityId: b.id,
        type: 'RELATED_TO',
        evidenceChunkIds: [randomUUID()],
        confidence: 0.7,
        status: 'pending',
      },
    });

    const confirmed = await service.confirmRelation(relation.id);
    expect(confirmed.status).toBe('active');
    expect(confirmed.origin).toBe('human');

    await service.merge(b.id, a.id);
    const merged = await prisma.entity.findUnique({ where: { id: b.id } });
    expect(merged?.status).toBe('merged');
    expect(merged?.mergedIntoId).toBe(a.id);

    await service.undoMerge(b.id);
    const restored = await prisma.entity.findUnique({ where: { id: b.id } });
    expect(restored?.status).toBe('active');
    expect(restored?.mergedIntoId).toBeNull();
  });
});
