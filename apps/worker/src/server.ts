import { fileURLToPath } from 'node:url';
import { config as loadDotenv } from 'dotenv';
import {
  ChunkRepository,
  createPrismaClient,
  DocumentRepository,
  JobRepository,
} from '@kos/database';
import { createIngestQueue, createIngestWorker, enqueueIngest } from '@kos/queue';
import { collectionName, createEmbeddingProvider } from '@kos/embeddings';
import { QdrantStore } from '@kos/retrieval';
import { loadEnv } from '@kos/shared';
import { LocalStorageAdapter } from '@kos/storage';
import { runPipeline } from './pipeline.js';
import { reconcileOnce, type ReconcileQueue } from './reconcile.js';

loadDotenv({ path: fileURLToPath(new URL('../../../.env', import.meta.url)) });

const env = loadEnv();
const prisma = createPrismaClient(env.DATABASE_URL);

async function loadConcurrency(): Promise<number> {
  const setting = await prisma.appSetting.findUnique({ where: { key: 'processing.concurrency' } });
  return typeof setting?.value === 'number' ? setting.value : 2;
}

const interrupted = await new JobRepository(prisma).markInterruptedRunningJobs();
if (interrupted > 0) {
  console.warn(`marked ${interrupted} interrupted job(s) as failed`);
}

const qdrant = new QdrantStore({
  url: env.QDRANT_URL,
  ...(env.QDRANT_API_KEY ? { apiKey: env.QDRANT_API_KEY } : {}),
  collection: collectionName(env.EMBEDDING_MODEL, env.EMBEDDING_DIM),
  vectorSize: env.EMBEDDING_DIM,
});

const deps = {
  prisma,
  documents: new DocumentRepository(prisma),
  chunks: new ChunkRepository(prisma),
  jobs: new JobRepository(prisma),
  storage: new LocalStorageAdapter(env.DATA_DIR),
  embeddings: createEmbeddingProvider(env),
  qdrant,
};

const worker = createIngestWorker(
  env.REDIS_URL,
  async (job) => {
    await runPipeline(deps, job.data.jobId);
  },
  { concurrency: await loadConcurrency() },
);

worker.on('failed', (job, error) => {
  console.error('ingest job failed', job?.id, error);
});

const ingestQueue = createIngestQueue(env.REDIS_URL);
const reconcileQueue: ReconcileQueue = {
  has: async (jobId) => Boolean(await ingestQueue.getJob(jobId)),
  enqueue: async (data) => {
    await enqueueIngest(ingestQueue, data);
  },
};

async function reconcile(): Promise<void> {
  try {
    const result = await reconcileOnce({ ...deps, queue: reconcileQueue });
    if (result.requeued > 0 || result.orphansDeleted > 0) {
      console.warn('reconcile result', result);
    }
  } catch (error) {
    console.error('reconcile failed', error);
  }
}

const reconcileTimer = setInterval(
  () => {
    void reconcile();
  },
  5 * 60 * 1000,
);
void reconcile();

async function shutdown(signal: string): Promise<void> {
  console.warn(`worker shutting down on ${signal}`);
  clearInterval(reconcileTimer);
  await worker.close();
  await ingestQueue.close();
  await prisma.$disconnect();
  process.exit(0);
}

process.on('SIGINT', () => {
  void shutdown('SIGINT');
});
process.on('SIGTERM', () => {
  void shutdown('SIGTERM');
});
