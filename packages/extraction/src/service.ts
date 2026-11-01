import { parseExtraction } from './parse.js';
import { buildExtractionPrompt, EXTRACTION_PROMPT_VERSION } from './prompt.js';
import type {
  ExtractChunkInput,
  ExtractionCache,
  ExtractionModel,
  ExtractionOutcome,
  ExtractionResult,
} from './types.js';

const ENTITIES_ONLY_BELOW = 200;
const SKIP_BELOW = 50;
const MAX_ATTEMPTS = 2;

export interface ExtractDeps {
  model: ExtractionModel;
  cache: ExtractionCache;
  promptVersion?: string;
}

function withChunkEvidence(result: ExtractionResult, chunkId: string): ExtractionResult {
  return {
    entities: result.entities.map((entity) => ({ ...entity, evidenceChunkId: chunkId })),
    relations: result.relations.map((relation) => ({ ...relation, evidenceChunkId: chunkId })),
    facts: result.facts.map((fact) => ({ ...fact, evidenceChunkId: chunkId })),
  };
}

export async function extractChunk(
  input: ExtractChunkInput,
  deps: ExtractDeps,
): Promise<ExtractionOutcome> {
  const budget = input.tokenBudgetLeft;
  if (budget !== undefined && budget < SKIP_BELOW) {
    return { status: 'skipped', reason: 'budget_exhausted', attempts: 0 };
  }
  const entitiesOnly = budget !== undefined && budget < ENTITIES_ONLY_BELOW;
  const promptVersion = deps.promptVersion ?? EXTRACTION_PROMPT_VERSION;

  const cached = await deps.cache.get(input.chunkId, deps.model.model, promptVersion);
  if (cached) {
    const result = withChunkEvidence(cached, input.chunkId);
    return {
      status: 'ok',
      result: entitiesOnly ? { ...result, relations: [], facts: [] } : result,
      cached: true,
      attempts: 0,
      entitiesOnly,
    };
  }

  const messages = buildExtractionPrompt({
    text: input.text,
    ...(input.contextBefore ? { contextBefore: input.contextBefore } : {}),
    ...(input.contextAfter ? { contextAfter: input.contextAfter } : {}),
    ...(input.knownEntities ? { knownEntities: input.knownEntities } : {}),
    entitiesOnly,
  });

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    let raw: string;
    try {
      raw = (await deps.model.complete(messages)).text;
    } catch {
      continue;
    }

    const parsed = parseExtraction(raw);
    if (!parsed) {
      continue;
    }

    const result = withChunkEvidence(parsed, input.chunkId);
    const filtered = entitiesOnly ? { ...result, relations: [], facts: [] } : result;
    await deps.cache.set(input.chunkId, deps.model.model, promptVersion, filtered);

    return {
      status: 'ok',
      result: filtered,
      cached: false,
      attempts: attempt,
      entitiesOnly,
    };
  }

  return { status: 'skipped', reason: 'schema_invalid', attempts: MAX_ATTEMPTS };
}
