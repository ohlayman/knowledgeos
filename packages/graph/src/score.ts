export const WEAK_RELATION_TYPES = new Set(['RELATED_TO']);
const WEAK_PENALTY = 0.9;

export interface ScoreableEdge {
  type: string;
  confidence: number;
  evidenceChunkIds: string[];
}

export interface PathScore {
  confidenceProduct: number;
  sourceQuality: number;
  weakPenalty: number;
  score: number;
}

export function scorePath(edges: ScoreableEdge[]): PathScore {
  if (edges.length === 0) {
    return { confidenceProduct: 0, sourceQuality: 0, weakPenalty: 0, score: 0 };
  }

  const confidenceProduct = edges.reduce((product, edge) => product * edge.confidence, 1);
  const sourceQuality =
    edges.reduce((sum, edge) => sum + Math.min(edge.evidenceChunkIds.length / 3, 1), 0) /
    edges.length;
  const weakCount = edges.filter((edge) => WEAK_RELATION_TYPES.has(edge.type)).length;
  const weakPenalty = WEAK_PENALTY ** weakCount;

  return {
    confidenceProduct,
    sourceQuality,
    weakPenalty,
    score: confidenceProduct * sourceQuality * weakPenalty,
  };
}
