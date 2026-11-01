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
  const documentIds: string[] = [];
  const chunkIds: string[] = [];
  const term = (name: string) => `${name}-${suffix.slice(0, 6)}`;
  const text = `${term('混合检索')} 使用 ${term('Hybrid Retrieval')} 的思路。`;

  const repo = new ExtractionRepository(prisma);

  afterAll(async () => {
    const chunksToClean = [chunkId, ...chunkIds].filter(Boolean);
    if (chunksToClean.length > 0) {
      await prisma.entity.deleteMany({
        where: { OR: chunksToClean.map((id) => ({ sourceChunkIds: { has: id } })) },
      });
      await prisma.extractionCache.deleteMany({ where: { chunkId: { in: chunksToClean } } });
    }
    const documentsToClean = [documentId, ...documentIds].filter(Boolean);
    if (documentsToClean.length > 0) {
      await prisma.document.deleteMany({ where: { id: { in: documentsToClean } } });
    }
    await prisma.source.deleteMany({
      where: { fingerprint: { in: [fingerprint, `${fingerprint}-gate`] } },
    });
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

  it('keeps weak and single-extraction relations pending until confirmed by repetition', async () => {
    const documents = new DocumentRepository(prisma);
    const created = await documents.createWithVersion({
      title: `graph-gate-${suffix}`,
      source: { type: 'manual', fingerprint: `${fingerprint}-gate`, identifier: 'gate' },
      version: { contentHash: `gate-${suffix}` },
    });
    documentIds.push(created.documentId);

    const textA = `${term('甲')} 与 ${term('乙')} 存在关联。`;
    const textB = `${term('甲')} 与 ${term('乙')} 再次出现。`;
    const chunks = new ChunkRepository(prisma);
    await chunks.replaceForVersion(created.documentId, created.versionId, [
      {
        chunkIndex: 0,
        text: textA,
        tokenCount: 10,
        startOffset: 0,
        endOffset: textA.length,
        searchText: '甲 乙',
      },
      {
        chunkIndex: 1,
        text: textB,
        tokenCount: 10,
        startOffset: textA.length + 1,
        endOffset: textA.length + 1 + textB.length,
        searchText: '甲 乙',
      },
    ]);
    const [firstChunk, secondChunk] = await chunks.listByVersion(created.versionId);
    chunkIds.push(firstChunk!.id, secondChunk!.id);

    const payload = {
      entities: [
        { name: term('甲'), type: 'concept' as const, aliases: [] },
        { name: term('乙'), type: 'concept' as const, aliases: [] },
      ],
      relations: [
        {
          from: term('甲'),
          to: term('乙'),
          type: 'RELATED_TO' as const,
          confidence: 0.9,
        },
      ],
      facts: [],
    };

    await repo.persistExtraction({ chunkId: firstChunk!.id, result: payload });
    let relation = await prisma.relation.findFirst({
      where: { fromEntity: { canonicalName: term('甲') }, toEntity: { canonicalName: term('乙') } },
    });
    expect(relation?.status).toBe('pending');

    await repo.persistExtraction({ chunkId: secondChunk!.id, result: payload });
    relation = await prisma.relation.findFirst({
      where: { fromEntity: { canonicalName: term('甲') }, toEntity: { canonicalName: term('乙') } },
    });
    expect(relation?.status).toBe('active');
    expect(relation?.evidenceChunkIds).toHaveLength(2);

    const lowConfidence = await repo.persistExtraction({
      chunkId: firstChunk!.id,
      result: {
        entities: payload.entities,
        relations: [{ from: term('甲'), to: term('乙'), type: 'USES', confidence: 0.4 }],
        facts: [],
      },
    });
    const weak = await prisma.relation.findFirst({
      where: {
        type: 'USES',
        fromEntity: { canonicalName: term('甲') },
        toEntity: { canonicalName: term('乙') },
      },
    });
    expect(weak?.status).toBe('pending');
    expect(lowConfidence.relations).toBe(0);
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
