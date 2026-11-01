import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { afterAll, describe, expect, it } from 'vitest';
import { ChunkRepository, DocumentRepository } from './repositories/index.js';
import { ExtractionRepository } from './repositories/extraction.js';

const enabled = process.env.RUN_DB_INTEGRATION === '1';
const prisma = new PrismaClient();

describe.skipIf(!enabled)('ExtractionRepository', () => {
  const suffix = randomUUID();
  const fingerprint = `extraction-${suffix}`;
  let documentId = '';
  let versionId = '';
  let chunkId = '';
  const term = (name: string) => `${name}-${suffix.slice(0, 6)}`;
  const text = `${term('混合检索')} 使用 ${term('Hybrid Retrieval')} 的思路。`;

  const repo = new ExtractionRepository(prisma);

  afterAll(async () => {
    if (chunkId) {
      await prisma.entity.deleteMany({ where: { sourceChunkIds: { has: chunkId } } });
      await prisma.extractionCache.deleteMany({ where: { chunkId } });
    }
    if (documentId) {
      await prisma.document.deleteMany({ where: { id: documentId } });
    }
    await prisma.source.deleteMany({ where: { fingerprint } });
    await prisma.$disconnect();
  });

  it('persists entities, relations and facts with evidence', async () => {
    const documents = new DocumentRepository(prisma);
    const created = await documents.createWithVersion({
      title: `extraction-${suffix}`,
      source: { type: 'manual', fingerprint, identifier: fingerprint },
      version: { contentHash: `hash-${suffix}` },
    });
    documentId = created.documentId;
    versionId = created.versionId;

    const chunks = new ChunkRepository(prisma);
    await chunks.replaceForVersion(documentId, versionId, [
      {
        chunkIndex: 0,
        text,
        tokenCount: 20,
        startOffset: 0,
        endOffset: text.length,
        searchText: '混合检索',
      },
    ]);
    chunkId = (await chunks.listByVersion(versionId))[0]!.id;

    const result = await repo.persistExtraction({
      chunkId,
      result: {
        entities: [
          { name: term('混合检索'), type: 'concept', aliases: [term('Hybrid Retrieval')] },
          { name: term('Hybrid Retrieval'), type: 'concept', aliases: [] },
          { name: term('向量召回'), type: 'concept', aliases: [] },
        ],
        relations: [
          { from: term('混合检索'), to: term('向量召回'), type: 'USES', confidence: 0.8 },
        ],
        facts: [
          {
            subject: term('混合检索'),
            predicate: '包含',
            value: term('向量召回'),
            valueType: 'text',
          },
        ],
      },
    });

    expect(result.entities).toBe(2);
    expect(result.relations).toBe(1);
    expect(result.facts).toBe(1);

    const entities = await prisma.entity.findMany({
      where: { sourceChunkIds: { has: chunkId } },
      orderBy: { canonicalName: 'asc' },
    });
    expect(entities).toHaveLength(2);
    const hybrid = entities.find((entity) => entity.canonicalName === term('混合检索'));
    expect(hybrid?.mentionCount).toBe(2);
    expect(hybrid?.aliases).toContain(term('Hybrid Retrieval'));

    const relation = await prisma.relation.findFirst({
      where: { evidenceChunkIds: { has: chunkId } },
    });
    expect(relation?.type).toBe('USES');

    const fact = await prisma.fact.findFirst({ where: { evidenceChunkId: chunkId } });
    expect(fact?.valueText).toBe(term('向量召回'));
  });

  it('is idempotent for repeated extraction of the same chunk', async () => {
    await repo.persistExtraction({
      chunkId,
      result: {
        entities: [
          { name: term('混合检索'), type: 'concept', aliases: [] },
          { name: term('向量召回'), type: 'concept', aliases: [] },
        ],
        relations: [
          { from: term('混合检索'), to: term('向量召回'), type: 'USES', confidence: 0.8 },
        ],
        facts: [
          {
            subject: term('混合检索'),
            predicate: '包含',
            value: term('向量召回'),
            valueType: 'text',
          },
        ],
      },
    });

    const relationCount = await prisma.relation.count({
      where: { evidenceChunkIds: { has: chunkId } },
    });
    const factCount = await prisma.fact.count({ where: { evidenceChunkId: chunkId } });
    expect(relationCount).toBe(1);
    expect(factCount).toBe(1);
  });

  it('caches extraction results per chunk, model and prompt version', async () => {
    const payload = { entities: [], relations: [], facts: [] };
    await repo.setCachedExtraction(chunkId, 'model-a', 'v1', payload);

    expect(await repo.getCachedExtraction(chunkId, 'model-a', 'v1')).toMatchObject(payload);
    expect(await repo.getCachedExtraction(chunkId, 'model-a', 'v2')).toBeNull();
    expect(await repo.getCachedExtraction(chunkId, 'model-b', 'v1')).toBeNull();
  });

  it('rejects extraction when the evidence chunk does not exist', async () => {
    await expect(
      repo.persistExtraction({
        chunkId: randomUUID(),
        result: {
          entities: [{ name: '不存在', type: 'concept', aliases: [] }],
          relations: [],
          facts: [],
        },
      }),
    ).rejects.toThrow(/chunk/);
  });
});
