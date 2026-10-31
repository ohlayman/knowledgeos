import { FakeEmbeddingProvider, OpenAICompatibleEmbeddingProvider } from '@kos/embeddings';
import type { Env } from '@kos/shared';

export function createEmbeddingProvider(env: Env) {
  const useFake = env.EMBEDDING_PROVIDER === 'fake' || !env.EMBEDDING_API_KEY;

  if (useFake) {
    if (env.NODE_ENV === 'production' && env.EMBEDDING_PROVIDER !== 'fake') {
      throw new Error('缺少 EMBEDDING_API_KEY，生产环境不能使用 Fake embedding');
    }
    return new FakeEmbeddingProvider(env.EMBEDDING_DIM);
  }

  return new OpenAICompatibleEmbeddingProvider({
    baseUrl: env.EMBEDDING_BASE_URL ?? 'https://api.openai.com/v1',
    apiKey: env.EMBEDDING_API_KEY!,
    model: env.EMBEDDING_MODEL,
    dim: env.EMBEDDING_DIM,
  });
}

export function collectionName(model: string, dim: number): string {
  return `kos_chunks_${model.toLowerCase().replace(/[^a-z0-9]+/g, '_')}_${dim}`;
}
