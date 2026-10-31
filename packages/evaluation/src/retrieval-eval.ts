export interface EvalCase {
  id: string;
  question: string;
  expectedDocumentId: string;
  type?: string;
}

export interface TypeMetrics {
  total: number;
  recallAt10: number;
}

export interface RetrievalEvalMetrics {
  total: number;
  recallAt10: number;
  mrrAt10: number;
  byType: Record<string, TypeMetrics>;
}

export type RetrieveFn = (question: string) => Promise<{ documentIds: string[] }>;

export async function evaluateRetrieval(
  cases: EvalCase[],
  retrieve: RetrieveFn,
): Promise<RetrievalEvalMetrics> {
  let hits = 0;
  let reciprocalRankSum = 0;
  const byType = new Map<string, { total: number; hits: number }>();

  for (const item of cases) {
    const { documentIds } = await retrieve(item.question);
    const top10 = documentIds.slice(0, 10);
    const rank = top10.indexOf(item.expectedDocumentId);

    if (rank >= 0) {
      hits += 1;
      reciprocalRankSum += 1 / (rank + 1);
    }

    if (item.type) {
      const bucket = byType.get(item.type) ?? { total: 0, hits: 0 };
      bucket.total += 1;
      if (rank >= 0) {
        bucket.hits += 1;
      }
      byType.set(item.type, bucket);
    }
  }

  return {
    total: cases.length,
    recallAt10: cases.length === 0 ? 0 : hits / cases.length,
    mrrAt10: cases.length === 0 ? 0 : reciprocalRankSum / cases.length,
    byType: Object.fromEntries(
      [...byType.entries()].map(([type, bucket]) => [
        type,
        {
          total: bucket.total,
          recallAt10: bucket.total === 0 ? 0 : bucket.hits / bucket.total,
        },
      ]),
    ),
  };
}

export function meetsGate(metrics: RetrievalEvalMetrics): boolean {
  return metrics.recallAt10 >= 0.85 && metrics.mrrAt10 >= 0.6;
}
