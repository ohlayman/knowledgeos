import { createHash } from 'node:crypto';
import type { ChunkRepository, Prisma, PrismaClient, WikiRepository } from '@kos/database';
import type { EmbeddingProvider } from '@kos/embeddings';
import {
  compilePage,
  detectConflicts,
  judgeOwnership,
  pageTypeForEntity,
  slugify,
  type CompileEvidence,
  type CompileFact,
  type CompileModel,
  type WikiPageContent,
  type WikiParagraph,
} from '@kos/wiki-engine';

export interface WikiCompileDeps {
  prisma: PrismaClient;
  chunks: ChunkRepository;
  wiki: WikiRepository;
  embeddings: EmbeddingProvider;
  model: CompileModel;
}

export interface WikiCompileSummary {
  entities: number;
  proposals: number;
  needsSplit: number;
  invalid: number;
}

function dedupeKey(versionId: string, target: string, changeType: string): string {
  return createHash('sha256').update(`${versionId}|${target}|${changeType}`).digest('hex');
}

function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let index = 0; index < Math.min(a.length, b.length); index += 1) {
    dot += a[index]! * b[index]!;
    normA += a[index]! ** 2;
    normB += b[index]! ** 2;
  }
  if (normA === 0 || normB === 0) {
    return 0;
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

function patchOps(
  ops: Array<Record<string, unknown>>,
  nextVersion: number,
): Array<Record<string, unknown>> {
  return ops.map((op) => {
    if (op.op === 'add') {
      const paragraph: WikiParagraph = {
        id: String(op.paragraphId),
        section: String(op.section),
        text: String(op.text),
        evidenceChunkIds: (op.evidenceChunkIds as string[]) ?? [],
        origin: 'model',
        versionIntroduced: nextVersion,
      };
      return { op: 'add', paragraph };
    }
    if (op.op === 'delete') {
      return { op: 'delete', paragraphId: op.paragraphId };
    }
    return op;
  });
}

export async function runWikiCompile(
  deps: WikiCompileDeps,
  input: { versionId: string },
): Promise<WikiCompileSummary> {
  const chunks = await deps.chunks.listByVersion(input.versionId);
  const chunkIds = chunks.map((chunk) => chunk.id);
  const summary: WikiCompileSummary = { entities: 0, proposals: 0, needsSplit: 0, invalid: 0 };

  if (chunkIds.length === 0) {
    return summary;
  }

  const entities = await deps.prisma.entity.findMany({
    where: { status: 'active', sourceChunkIds: { hasSome: chunkIds } },
  });

  const embeddingCache = new Map<string, number[]>();
  const embed = async (text: string): Promise<number[]> => {
    const cached = embeddingCache.get(text);
    if (cached) {
      return cached;
    }
    const [vector] = await deps.embeddings.embed([text]);
    const value = vector ?? [];
    embeddingCache.set(text, value);
    return value;
  };

  for (const entity of entities) {
    summary.entities += 1;
    const evidenceRows = await deps.prisma.chunk.findMany({
      where: { id: { in: entity.sourceChunkIds.slice(0, 12) } },
      select: { id: true, text: true },
    });
    if (evidenceRows.length === 0) {
      continue;
    }
    const evidence: CompileEvidence[] = evidenceRows.map((row) => ({
      chunkId: row.id,
      text: row.text,
    }));

    const factRows = await deps.prisma.fact.findMany({
      where: { subjectEntityId: entity.id },
      select: { predicate: true, valueText: true, evidenceChunkId: true, capturedAt: true },
    });
    const facts: CompileFact[] = factRows.map((fact) => ({
      subject: entity.canonicalName,
      predicate: fact.predicate,
      value: fact.valueText,
    }));
    const conflictFacts = factRows.map((fact) => ({
      subject: entity.canonicalName,
      predicate: fact.predicate,
      value: fact.valueText,
      evidenceChunkId: fact.evidenceChunkId,
      observedAt: fact.capturedAt.toISOString(),
    }));
    const conflicts = detectConflicts(conflictFacts);

    const relationRows = await deps.prisma.relation.findMany({
      where: {
        OR: [{ fromEntityId: entity.id }, { toEntityId: entity.id }],
        status: 'active',
      },
      include: { fromEntity: true, toEntity: true },
    });
    const relations = relationRows.map((relation) => ({
      from: relation.fromEntity.canonicalName,
      to: relation.toEntity.canonicalName,
      type: relation.type,
    }));

    const pages = await deps.wiki.pageCandidates();
    const decision = await judgeOwnership({
      entity: {
        name: entity.canonicalName,
        type: entity.type,
        sourceChunkIds: entity.sourceChunkIds,
      },
      pages,
      similarity: async (entityName, pageTitle) =>
        cosine(await embed(entityName), await embed(pageTitle)),
    });

    if (decision.kind === 'merge_suggestion' && decision.pageId) {
      await deps.wiki.createProposal({
        targetPageId: decision.pageId,
        changeType: 'merge_suggestion',
        dedupeKey: dedupeKey(input.versionId, decision.pageId, 'merge_suggestion'),
        patch: {
          summary: `「${entity.canonicalName}」与目标页面可能为同一概念，建议人工确认是否合并`,
          ops: [],
        } as unknown as Prisma.InputJsonValue,
        evidence: { entityId: entity.id, chunkIds: evidence.map((item) => item.chunkId) },
        modelMeta: { model: deps.model.model, generatedAt: new Date().toISOString() },
        documentVersionId: input.versionId,
        mergeWindowMs: 10 * 60 * 1000,
      });
      summary.proposals += 1;
      continue;
    }

    const existingPage =
      decision.kind === 'existing' && decision.pageId
        ? await deps.wiki.getPageById(decision.pageId)
        : null;
    const pageType =
      existingPage?.type ??
      pageTypeForEntity(entity.type as Parameters<typeof pageTypeForEntity>[0]);
    const existingContent = existingPage?.currentRevision
      ? (existingPage.currentRevision.content as unknown as WikiPageContent)
      : null;

    const outcome = await compilePage(
      {
        pageType,
        entityName: entity.canonicalName,
        evidence,
        facts,
        relations,
        existing: existingContent,
      },
      { model: deps.model },
    );

    if (outcome.status === 'needs_split') {
      summary.needsSplit += 1;
      continue;
    }
    if (outcome.status === 'invalid') {
      summary.invalid += 1;
      continue;
    }

    const nextVersion = (existingContent?.paragraphs.length ?? 0) + 1;
    const ops = patchOps(outcome.patch as unknown as Array<Record<string, unknown>>, nextVersion);

    if (existingPage && decision.kind === 'existing') {
      await deps.wiki.createProposal({
        targetPageId: existingPage.id,
        changeType: 'update',
        baseRevisionId: existingPage.currentRevisionId,
        dedupeKey: dedupeKey(input.versionId, existingPage.id, 'update'),
        patch: { summary: outcome.content.summary, ops } as unknown as Prisma.InputJsonValue,
        evidence: {
          entityId: entity.id,
          chunkIds: evidence.map((item) => item.chunkId),
        } as unknown as Prisma.InputJsonValue,
        conflicts: conflicts as unknown as Prisma.InputJsonValue,
        validation: outcome.validation as unknown as Prisma.InputJsonValue,
        modelMeta: { model: deps.model.model, generatedAt: new Date().toISOString() },
        documentVersionId: input.versionId,
        mergeWindowMs: 10 * 60 * 1000,
      });
    } else {
      const slug = slugify(entity.canonicalName);
      await deps.wiki.createProposal({
        changeType: 'create',
        dedupeKey: dedupeKey(input.versionId, slug, 'create'),
        patch: {
          summary: outcome.content.summary,
          ops,
          newPage: {
            slug,
            title: entity.canonicalName,
            type: pageType,
            summary: outcome.content.summary,
          },
        } as unknown as Prisma.InputJsonValue,
        evidence: {
          entityId: entity.id,
          chunkIds: evidence.map((item) => item.chunkId),
        } as unknown as Prisma.InputJsonValue,
        conflicts: conflicts as unknown as Prisma.InputJsonValue,
        validation: outcome.validation as unknown as Prisma.InputJsonValue,
        modelMeta: { model: deps.model.model, generatedAt: new Date().toISOString() },
        documentVersionId: input.versionId,
        mergeWindowMs: 10 * 60 * 1000,
      });
    }

    summary.proposals += 1;
  }

  return summary;
}
