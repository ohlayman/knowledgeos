import { buildSearchText } from '@kos/shared';
import type { ChunkRow, Evidence } from './types.js';

export interface ScoredChunk {
  id: string;
  score: number;
}

export function keywordOverlap(question: string, texts: string[]): number {
  const tokens = [
    ...new Set(
      buildSearchText(question)
        .split(' ')
        .filter((token) => token.length > 1),
    ),
  ];
  if (tokens.length === 0 || texts.length === 0) {
    return 0;
  }

  const haystack = texts.join('\n').toLowerCase();
  const matched = tokens.filter((token) => haystack.includes(token.toLowerCase())).length;
  return matched / tokens.length;
}

export function assembleEvidence(
  ordered: ScoredChunk[],
  chunks: Map<string, ChunkRow>,
  sourcePaths: Map<string, string>,
  options: { topK: number; tokenBudget: number },
): Evidence[] {
  const evidence: Evidence[] = [];
  let usedTokens = 0;

  for (const candidate of ordered) {
    if (evidence.length >= options.topK) {
      break;
    }

    const chunk = chunks.get(candidate.id);
    if (!chunk) {
      continue;
    }
    if (evidence.length > 0 && usedTokens + chunk.tokenCount > options.tokenBudget) {
      break;
    }

    usedTokens += chunk.tokenCount;
    const sourcePath = sourcePaths.get(chunk.versionId);

    evidence.push({
      chunkId: chunk.chunkId,
      documentId: chunk.documentId,
      versionId: chunk.versionId,
      text: chunk.text,
      score: candidate.score,
      ...(sourcePath ? { sourcePath } : {}),
      ...(chunk.pageStart === null ? {} : { page: chunk.pageStart }),
      headingPath: chunk.headingPath,
    });
  }

  return evidence;
}
