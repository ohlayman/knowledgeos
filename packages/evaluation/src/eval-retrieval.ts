import { fileURLToPath } from 'node:url';
import { config as loadDotenv } from 'dotenv';
import { createPrismaClient } from '@kos/database';
import { collectionName, createEmbeddingProvider } from '@kos/embeddings';
import { QdrantStore, RetrievalService } from '@kos/retrieval';
import { loadEnv } from '@kos/shared';
import { loadCorpus, loadDataset, seedCorpus } from './corpus.js';
import { evaluateRetrieval, meetsGate, type EvalCase } from './retrieval-eval.js';

loadDotenv({ path: fileURLToPath(new URL('../../../.env', import.meta.url)) });

const env = loadEnv();
const prisma = createPrismaClient(env.DATABASE_URL);
const embeddings = createEmbeddingProvider(env);
const qdrant = new QdrantStore({
  url: env.QDRANT_URL,
  ...(env.QDRANT_API_KEY ? { apiKey: env.QDRANT_API_KEY } : {}),
  collection: collectionName(env.EMBEDDING_MODEL, env.EMBEDDING_DIM),
  vectorSize: env.EMBEDDING_DIM,
});

const fingerprintPrefix = 'eval://retrieval';
await qdrant.ensureCollection();
await qdrant.createPayloadIndexes();

const bySlug = await seedCorpus(loadCorpus(), { prisma, embeddings, qdrant, fingerprintPrefix });
const cases: EvalCase[] = loadDataset().flatMap((item) => {
  const documentId = bySlug.get(item.expectedSlug);
  return documentId
    ? [
        {
          id: item.id,
          question: item.question,
          expectedDocumentId: documentId,
          ...(item.type ? { type: item.type } : {}),
        },
      ]
    : [];
});

const service = new RetrievalService({ prisma, embeddings, qdrant });

const metrics = await evaluateRetrieval(cases, async (question) => {
  const result = await service.retrieve(question, {
    documentIds: [...bySlug.values()],
    finalTopK: 10,
    rerankEnabled: false,
  });
  return { documentIds: result.evidence.map((item) => item.documentId) };
});

console.log(JSON.stringify(metrics, null, 2));

// 评测语料不进入用户知识库：评估结束立即清理。
await prisma.document.deleteMany({ where: { id: { in: [...bySlug.values()] } } });
await prisma.source.deleteMany({ where: { fingerprint: { startsWith: fingerprintPrefix } } });
await prisma.$disconnect();

if (!meetsGate(metrics)) {
  console.error('retrieval gate failed: recall@10 >= 0.85, mrr@10 >= 0.6');
  process.exit(1);
}
