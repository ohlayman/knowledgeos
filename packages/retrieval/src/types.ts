export type QuestionType = 'fact' | 'comparison' | 'relation' | 'procedure' | 'open';

export interface QueryUnderstandingResult {
  rewrittenQuery: string;
  entities: string[];
  questionType: QuestionType;
  keywordHints: string[];
}

export interface QueryUnderstanding {
  understand(question: string): Promise<QueryUnderstandingResult>;
}

export interface RetrievalOptions {
  documentIds?: string[];
  tags?: string[];
  includeHistoryVersions?: boolean;
  vectorTopN?: number;
  vectorScoreThreshold?: number;
  keywordTopN?: number;
  finalTopK?: number;
  rrfK?: number;
  evidenceTokenBudget?: number;
  rerankEnabled?: boolean;
}

export interface ChunkRow {
  chunkId: string;
  documentId: string;
  versionId: string;
  text: string;
  headingPath: string[];
  pageStart: number | null;
  pageEnd: number | null;
  tokenCount: number;
  vectorScore?: number;
  keywordScore?: number;
}

export interface Evidence {
  chunkId: string;
  documentId: string;
  versionId: string;
  text: string;
  score: number;
  sourcePath?: string;
  page?: number;
  headingPath: string[];
}

export interface RetrievalPathEdge {
  from: string;
  to: string;
  type: string;
  confidence: number;
  evidenceChunkIds: string[];
}

export interface RetrievalPath {
  nodeNames: string[];
  edges: RetrievalPathEdge[];
  chunkIds: string[];
  evidenceRefs?: Array<{ chunkId: string; documentId: string }>;
  score: number;
  scoreBreakdown: {
    confidenceProduct: number;
    sourceQuality: number;
    weakPenalty: number;
  };
}

export interface GraphPort {
  searchPaths(entities: string[], maxHops?: number): Promise<RetrievalPath[]>;
}

export interface RetrievalTrace {
  rewrittenQuery: string;
  questionType: QuestionType;
  entities: string[];
  keywordHints: string[];
  vectorHits: number;
  keywordHits: number;
  fusedCount: number;
  reranked: boolean;
  degraded: string[];
  durationMs: number;
  timings: Record<string, number>;
  graphHits?: number;
  paths?: RetrievalPath[];
}

export interface RetrievalResult {
  runId?: string;
  evidence: Evidence[];
  noEvidence: boolean;
  trace: RetrievalTrace;
}

export interface RerankCandidate {
  id: string;
  text: string;
  score: number;
}

export interface RerankProvider {
  rerank(
    question: string,
    candidates: RerankCandidate[],
  ): Promise<Array<{ id: string; score: number }> | null>;
}
