export const RETRIEVAL_DEFAULTS = {
  topK: 10,
  vectorTopN: 40,
  keywordTopN: 40,
  rrfK: 60,
  rerankTopN: 30,
  evidenceTokenBudget: 6000,
} as const;

export const CHUNK_DEFAULTS = {
  targetMin: 300,
  targetMax: 800,
  hardMax: 1200,
  min: 80,
  overlapRatio: 0.1,
} as const;

export const LIMITS = {
  maxFileSizeBytes: 20 * 1024 * 1024,
  maxBatchFiles: 200,
  maxUrlsPerBatch: 20,
  maxTextChars: 200_000,
  maxQuestionChars: 2_000,
} as const;
