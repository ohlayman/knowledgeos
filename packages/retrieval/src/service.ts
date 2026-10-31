import { randomUUID } from 'node:crypto';
import type { Prisma, PrismaClient } from '@kos/database';
import type { EmbeddingProvider } from '@kos/embeddings';
import { buildTsQuery, rrf } from '@kos/shared';
import type { QdrantStore } from './qdrant.js';
import { assembleEvidence, keywordOverlap } from './evidence.js';
import { keywordSearch } from './keyword.js';
import { RuleBasedQueryUnderstanding } from './query.js';
import type {
  ChunkRow,
  QueryUnderstanding,
  RerankCandidate,
  RerankProvider,
  RetrievalOptions,
  RetrievalResult,
  RetrievalTrace,
} from './types.js';

export interface RetrievalServiceDeps {
  prisma: PrismaClient;
  embeddings: EmbeddingProvider;
  qdrant: QdrantStore;
  understander?: QueryUnderstanding;
  reranker?: RerankProvider;
}

const DEFAULT_VECTOR_TOP_N = 40;
const DEFAULT_FINAL_TOP_K = 10;
const DEFAULT_RRF_K = 60;
const DEFAULT_EVIDENCE_BUDGET = 6000;
const DEFAULT_VECTOR_SCORE_THRESHOLD = 0.2;
const MIN_VECTOR_SCORE = 0.25;
const RERANK_TIMEOUT_MS = 5000;
const RERANK_CANDIDATES = 30;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}

interface ChunkRecord {
  id: string;
  documentId: string;
  versionId: string;
  text: string;
  headingPath: string[];
  pageStart: number | null;
  pageEnd: number | null;
  tokenCount: number;
}

function toChunkRow(record: ChunkRecord, extra: Partial<ChunkRow>): ChunkRow {
  return {
    chunkId: record.id,
    documentId: record.documentId,
    versionId: record.versionId,
    text: record.text,
    headingPath: record.headingPath,
    pageStart: record.pageStart,
    pageEnd: record.pageEnd,
    tokenCount: record.tokenCount,
    ...extra,
  };
}

export class RetrievalService {
  private readonly understander: QueryUnderstanding;

  constructor(private readonly deps: RetrievalServiceDeps) {
    this.understander = deps.understander ?? new RuleBasedQueryUnderstanding();
  }

  async retrieve(question: string, options: RetrievalOptions = {}): Promise<RetrievalResult> {
    const startedAt = Date.now();
    const timings: Record<string, number> = {};
    const degraded: string[] = [];

    const understandingStart = Date.now();
    const understanding = await this.understander.understand(question);
    timings.understand = Date.now() - understandingStart;

    const subQueries =
      understanding.questionType === 'comparison' && understanding.entities.length >= 2
        ? understanding.entities
        : [understanding.rewrittenQuery];

    const chunks = new Map<string, ChunkRow>();
    const vectorLists: Array<Array<{ id: string }>> = [];
    const keywordLists: Array<Array<{ id: string }>> = [];
    let vectorHits = 0;
    let keywordHits = 0;
    let maxVectorScore = 0;

    const searchStart = Date.now();
    for (const subQuery of subQueries) {
      const [vectorRows, keywordRows] = await Promise.all([
        this.safeVectorSearch(subQuery, options, degraded),
        this.safeKeywordSearch(subQuery, options, degraded),
      ]);

      vectorHits += vectorRows.length;
      keywordHits += keywordRows.length;
      vectorLists.push(vectorRows.map((row) => ({ id: row.chunkId })));
      keywordLists.push(keywordRows.map((row) => ({ id: row.chunkId })));

      for (const row of [...vectorRows, ...keywordRows]) {
        const existing = chunks.get(row.chunkId);
        chunks.set(row.chunkId, existing ? { ...existing, ...row } : row);
        if (row.vectorScore !== undefined) {
          maxVectorScore = Math.max(maxVectorScore, row.vectorScore);
        }
      }
    }
    timings.search = Date.now() - searchStart;

    if (
      vectorLists.every((list) => list.length === 0) &&
      keywordLists.every((list) => list.length === 0)
    ) {
      if (degraded.includes('vector_unavailable') && degraded.includes('keyword_unavailable')) {
        throw new Error('both retrieval paths failed');
      }
    }

    const fused = rrf([...vectorLists, ...keywordLists], options.rrfK ?? DEFAULT_RRF_K);

    let ordered = fused.map((item) => ({ id: item.id, score: item.score }));
    let reranked = false;

    const rerankStart = Date.now();
    if (this.deps.reranker && options.rerankEnabled !== false && ordered.length > 0) {
      const candidates: RerankCandidate[] = ordered.slice(0, RERANK_CANDIDATES).flatMap((item) => {
        const chunk = chunks.get(item.id);
        return chunk ? [{ id: item.id, text: chunk.text, score: item.score }] : [];
      });

      try {
        const rerankResult = await withTimeout(
          this.deps.reranker.rerank(question, candidates),
          RERANK_TIMEOUT_MS,
        );
        if (rerankResult && rerankResult.length > 0) {
          const scores = new Map(rerankResult.map((item) => [item.id, item.score]));
          const head = ordered
            .filter((item) => scores.has(item.id))
            .sort((a, b) => (scores.get(b.id) ?? 0) - (scores.get(a.id) ?? 0));
          const tail = ordered.filter((item) => !scores.has(item.id));
          ordered = [...head, ...tail];
          reranked = true;
        } else {
          degraded.push('rerank_skipped');
        }
      } catch {
        degraded.push('rerank_skipped');
      }
    } else if (options.rerankEnabled !== false && this.deps.reranker === undefined) {
      degraded.push('rerank_skipped');
    }
    timings.rerank = Date.now() - rerankStart;

    const versionIds = [...new Set([...chunks.values()].map((chunk) => chunk.versionId))];
    const versions = await this.deps.prisma.documentVersion.findMany({
      where: { id: { in: versionIds } },
      select: { id: true, originalFilename: true },
    });
    const sourcePaths = new Map(
      versions.flatMap((version) =>
        version.originalFilename ? [[version.id, version.originalFilename] as const] : [],
      ),
    );

    const assembleStart = Date.now();
    const evidence = assembleEvidence(ordered, chunks, sourcePaths, {
      topK: options.finalTopK ?? DEFAULT_FINAL_TOP_K,
      tokenBudget: options.evidenceTokenBudget ?? DEFAULT_EVIDENCE_BUDGET,
    });
    timings.assemble = Date.now() - assembleStart;

    const overlap = keywordOverlap(
      question,
      evidence.map((item) => item.text),
    );
    const noEvidence =
      evidence.length === 0 || (maxVectorScore < MIN_VECTOR_SCORE && overlap < 0.1);

    const trace: RetrievalTrace = {
      rewrittenQuery: understanding.rewrittenQuery,
      questionType: understanding.questionType,
      entities: understanding.entities,
      keywordHints: understanding.keywordHints,
      vectorHits,
      keywordHits,
      fusedCount: fused.length,
      reranked,
      degraded,
      durationMs: Date.now() - startedAt,
      timings,
    };

    const runId = await this.persistRun(question, options, trace, fused, evidence, degraded);

    return {
      ...(runId ? { runId } : {}),
      evidence,
      noEvidence,
      trace,
    };
  }

  private async safeVectorSearch(
    query: string,
    options: RetrievalOptions,
    degraded: string[],
  ): Promise<ChunkRow[]> {
    try {
      return await this.vectorSearch(query, options);
    } catch {
      if (!degraded.includes('vector_unavailable')) {
        degraded.push('vector_unavailable');
      }
      return [];
    }
  }

  private async safeKeywordSearch(
    query: string,
    options: RetrievalOptions,
    degraded: string[],
  ): Promise<ChunkRow[]> {
    try {
      return await keywordSearch(this.deps.prisma, buildTsQuery(query), options);
    } catch {
      if (!degraded.includes('keyword_unavailable')) {
        degraded.push('keyword_unavailable');
      }
      return [];
    }
  }

  private async vectorSearch(query: string, options: RetrievalOptions): Promise<ChunkRow[]> {
    const [vector] = await this.deps.embeddings.embed([query]);
    if (!vector) {
      return [];
    }

    const hits = await this.deps.qdrant.search(vector, {
      limit: options.vectorTopN ?? DEFAULT_VECTOR_TOP_N,
      scoreThreshold: options.vectorScoreThreshold ?? DEFAULT_VECTOR_SCORE_THRESHOLD,
      filter: {
        ...(options.includeHistoryVersions ? {} : { isCurrent: true }),
        ...(options.documentIds?.length ? { documentIds: options.documentIds } : {}),
        ...(options.tags?.length ? { tags: options.tags } : {}),
      },
    });
    if (hits.length === 0) {
      return [];
    }

    const records = await this.deps.prisma.chunk.findMany({
      where: { id: { in: hits.map((hit) => hit.id) } },
    });
    const byId = new Map(records.map((record) => [record.id, record]));

    return hits.flatMap((hit) => {
      const record = byId.get(hit.id);
      return record ? [toChunkRow(record, { vectorScore: hit.score })] : [];
    });
  }

  private async persistRun(
    question: string,
    options: RetrievalOptions,
    trace: RetrievalTrace,
    fused: Array<{ id: string; score: number }>,
    evidence: RetrievalResult['evidence'],
    degraded: string[],
  ): Promise<string | undefined> {
    try {
      const run = await this.deps.prisma.retrievalRun.create({
        data: {
          id: randomUUID(),
          query: question,
          rewrittenQuery: trace.rewrittenQuery,
          questionType: trace.questionType,
          entities: trace.entities,
          config: options as unknown as Prisma.InputJsonValue,
          fusedResults: fused.slice(0, 100) as unknown as Prisma.InputJsonValue,
          finalChunkIds: evidence.map((item) => item.chunkId),
          degraded,
          durationMs: trace.durationMs,
        },
      });
      return run.id;
    } catch {
      return undefined;
    }
  }
}
