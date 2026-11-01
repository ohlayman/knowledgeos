import { createHash, randomUUID } from 'node:crypto';
import type { EntityType, Prisma, PrismaClient, RelationType } from '@prisma/client';
import { normalizeEntityName } from '@kos/shared';

export interface ExtractionEntityInput {
  name: string;
  type: EntityType;
  aliases?: string[];
}

export interface ExtractionRelationInput {
  from: string;
  to: string;
  type: RelationType;
  confidence?: number;
}

export interface ExtractionFactInput {
  subject: string;
  predicate: string;
  value: string;
  valueType?: string | null;
}

export interface ExtractionPayloadInput {
  entities: ExtractionEntityInput[];
  relations: ExtractionRelationInput[];
  facts: ExtractionFactInput[];
}

export interface PersistExtractionInput {
  chunkId: string;
  result: ExtractionPayloadInput;
}

export interface PersistExtractionResult {
  entities: number;
  relations: number;
  facts: number;
  mentions: number;
}

export class ExtractionRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async getCachedExtraction(
    chunkId: string,
    model: string,
    promptVersion: string,
  ): Promise<Prisma.JsonValue | null> {
    const row = await this.prisma.extractionCache.findUnique({
      where: { chunkId_model_promptVersion: { chunkId, model, promptVersion } },
      select: { result: true },
    });
    return row?.result ?? null;
  }

  async setCachedExtraction(
    chunkId: string,
    model: string,
    promptVersion: string,
    result: Prisma.InputJsonValue,
  ): Promise<void> {
    await this.prisma.extractionCache.upsert({
      where: { chunkId_model_promptVersion: { chunkId, model, promptVersion } },
      update: { result },
      create: { id: randomUUID(), chunkId, model, promptVersion, result },
    });
  }

  async persistExtraction(input: PersistExtractionInput): Promise<PersistExtractionResult> {
    return this.prisma.$transaction(async (tx) => {
      const chunk = await tx.chunk.findUnique({
        where: { id: input.chunkId },
        select: { id: true, text: true },
      });
      if (!chunk) {
        throw new Error(`chunk ${input.chunkId} not found`);
      }

      const byName = new Map<string, string>();
      const candidatesByType = new Map<
        EntityType,
        Array<{ id: string; normalizedName: string; aliases: string[]; sourceChunkIds: string[] }>
      >();
      const touchedEntities = new Set<string>();
      let mentions = 0;

      const candidates = async (type: EntityType) => {
        const cached = candidatesByType.get(type);
        if (cached) {
          return cached;
        }
        const rows = await tx.entity.findMany({
          where: { type, status: 'active' },
          select: { id: true, normalizedName: true, aliases: true, sourceChunkIds: true },
        });
        candidatesByType.set(type, rows);
        return rows;
      };

      const findAligned = async (normalized: string, type: EntityType) => {
        const rows = await candidates(type);
        return rows.find(
          (row) =>
            row.normalizedName === normalized ||
            row.aliases.some((alias) => normalizeEntityName(alias) === normalized),
        );
      };

      for (const entity of input.result.entities) {
        const normalizedName = normalizeEntityName(entity.name);
        if (normalizedName.length === 0) {
          continue;
        }

        const existing = await findAligned(normalizedName, entity.type);
        const aliases = [...new Set((entity.aliases ?? []).map((alias) => alias.trim()))].filter(
          (alias) => alias.length > 0,
        );

        const entityId = existing
          ? existing.id
          : (
              await tx.entity.create({
                data: {
                  id: randomUUID(),
                  canonicalName: entity.name,
                  normalizedName,
                  type: entity.type,
                  aliases,
                  sourceChunkIds: [input.chunkId],
                  mentionCount: 0,
                  confidence: 0.5,
                },
              })
            ).id;

        if (!existing) {
          const rows = await candidates(entity.type);
          rows.push({ id: entityId, normalizedName, aliases, sourceChunkIds: [input.chunkId] });
        }

        const offset = chunk.text.indexOf(entity.name);
        let inserted = 0;
        if (offset >= 0) {
          const result = await tx.entityMention.createMany({
            data: [
              {
                id: randomUUID(),
                entityId,
                chunkId: input.chunkId,
                startOffset: offset,
                endOffset: offset + entity.name.length,
              },
            ],
            skipDuplicates: true,
          });
          inserted = result.count;
          mentions += inserted;
        }

        const current = await tx.entity.findUniqueOrThrow({
          where: { id: entityId },
          select: { sourceChunkIds: true, aliases: true },
        });
        await tx.entity.update({
          where: { id: entityId },
          data: {
            sourceChunkIds: current.sourceChunkIds.includes(input.chunkId)
              ? current.sourceChunkIds
              : [...current.sourceChunkIds, input.chunkId],
            aliases: [...new Set([...current.aliases, ...aliases])],
            ...(inserted > 0 ? { mentionCount: { increment: inserted } } : {}),
          },
        });

        byName.set(normalizedName, entityId);
        touchedEntities.add(entityId);
      }

      const resolve = async (name: string): Promise<string | null> => {
        const normalized = normalizeEntityName(name);
        if (normalized.length === 0) {
          return null;
        }
        const mapped = byName.get(normalized);
        if (mapped) {
          return mapped;
        }
        const found = await tx.entity.findFirst({
          where: { normalizedName: normalized, status: 'active' },
          select: { id: true },
        });
        return found?.id ?? null;
      };

      let relations = 0;
      for (const relation of input.result.relations) {
        const fromId = await resolve(relation.from);
        const toId = await resolve(relation.to);
        if (!fromId || !toId || fromId === toId) {
          continue;
        }

        const duplicate = await tx.relation.findFirst({
          where: { fromEntityId: fromId, toEntityId: toId, type: relation.type, status: 'active' },
          select: { id: true, evidenceChunkIds: true },
        });
        if (duplicate) {
          if (!duplicate.evidenceChunkIds.includes(input.chunkId)) {
            await tx.relation.update({
              where: { id: duplicate.id },
              data: { evidenceChunkIds: [...duplicate.evidenceChunkIds, input.chunkId] },
            });
          }
          continue;
        }

        await tx.relation.create({
          data: {
            id: randomUUID(),
            fromEntityId: fromId,
            toEntityId: toId,
            type: relation.type,
            evidenceChunkIds: [input.chunkId],
            confidence: relation.confidence ?? 0.5,
          },
        });
        relations += 1;
      }

      let facts = 0;
      for (const fact of input.result.facts) {
        const subjectId = await resolve(fact.subject);
        if (!subjectId) {
          continue;
        }

        const duplicate = await tx.fact.findFirst({
          where: {
            subjectEntityId: subjectId,
            predicate: fact.predicate,
            valueText: fact.value,
            evidenceChunkId: input.chunkId,
          },
          select: { id: true },
        });
        if (duplicate) {
          continue;
        }

        await tx.fact.create({
          data: {
            id: randomUUID(),
            subjectEntityId: subjectId,
            predicate: fact.predicate,
            valueText: fact.value,
            valueType: fact.valueType ?? null,
            evidenceChunkId: input.chunkId,
            identityHash: createHash('sha256')
              .update(`${subjectId}|${fact.predicate.toLowerCase()}|${fact.value}`)
              .digest('hex'),
          },
        });
        facts += 1;
      }

      return { entities: touchedEntities.size, relations, facts, mentions };
    });
  }
}
