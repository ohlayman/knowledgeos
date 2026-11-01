import type { ChunkRepository, ExtractionRepository, PrismaClient } from '@kos/database';
import {
  extractChunk,
  type ExtractionCache,
  type ExtractionModel,
  type ExtractionResult,
} from '@kos/extraction';
import { EXTRACTION_PROMPT_VERSION } from '@kos/extraction';

export interface ExtractionDeps {
  prisma: PrismaClient;
  chunks: ChunkRepository;
  extraction: ExtractionRepository;
  model: ExtractionModel;
  tokenBudget?: number;
}

export interface ExtractionSummary {
  chunks: number;
  extracted: number;
  skipped: number;
  entities: number;
  relations: number;
  facts: number;
}

function cacheAdapter(repository: ExtractionRepository): ExtractionCache {
  return {
    get: async (chunkId, model, promptVersion) =>
      (await repository.getCachedExtraction(
        chunkId,
        model,
        promptVersion,
      )) as ExtractionResult | null,
    set: async (chunkId, model, promptVersion, result) => {
      await repository.setCachedExtraction(chunkId, model, promptVersion, result);
    },
  };
}

export async function runExtraction(
  deps: ExtractionDeps,
  input: { versionId: string },
): Promise<ExtractionSummary> {
  const chunks = await deps.chunks.listByVersion(input.versionId);
  const knownEntities = await deps.prisma.entity.findMany({
    where: { status: 'active' },
    select: { canonicalName: true },
    take: 200,
  });

  let budget = deps.tokenBudget ?? 200_000;
  const summary: ExtractionSummary = {
    chunks: chunks.length,
    extracted: 0,
    skipped: 0,
    entities: 0,
    relations: 0,
    facts: 0,
  };

  const cache = cacheAdapter(deps.extraction);

  for (let index = 0; index < chunks.length; index += 1) {
    const chunk = chunks[index]!;
    const estimated = Math.ceil(chunk.text.length / 4);
    budget -= estimated;

    const outcome = await extractChunk(
      {
        chunkId: chunk.id,
        text: chunk.text,
        ...(chunks[index - 1] ? { contextBefore: chunks[index - 1]!.text.slice(-500) } : {}),
        ...(chunks[index + 1] ? { contextAfter: chunks[index + 1]!.text.slice(0, 500) } : {}),
        knownEntities: knownEntities.map((entity) => entity.canonicalName),
        tokenBudgetLeft: budget,
      },
      { model: deps.model, cache, promptVersion: EXTRACTION_PROMPT_VERSION },
    );

    if (outcome.status === 'skipped') {
      summary.skipped += 1;
      continue;
    }

    summary.extracted += 1;
    const persisted = await deps.extraction.persistExtraction({
      chunkId: chunk.id,
      result: outcome.result,
    });
    summary.entities += persisted.entities;
    summary.relations += persisted.relations;
    summary.facts += persisted.facts;
  }

  return summary;
}
