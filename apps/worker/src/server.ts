import { fileURLToPath } from 'node:url';
import { config as loadDotenv } from 'dotenv';
import {
  ChunkRepository,
  createPrismaClient,
  DocumentRepository,
  ExtractionRepository,
  JobRepository,
  loadProviderSettings,
  WikiRepository,
} from '@kos/database';
import {
  createDocumentQueue,
  createDocumentWorker,
  createIngestQueue,
  createIngestWorker,
  enqueueDocument,
  enqueueIngest,
  EXTRACT_QUEUE,
  WIKI_COMPILE_QUEUE,
} from '@kos/queue';
import { collectionName, createEmbeddingProvider } from '@kos/embeddings';
import { FakeExtractionModel, type ExtractionModel } from '@kos/extraction';
import { createChatProvider } from '@kos/llm';
import { QdrantStore } from '@kos/retrieval';
import { loadEnv } from '@kos/shared';
import { LocalStorageAdapter, resolveDataDir } from '@kos/storage';
import { FakeCompileModel, type CompileModel } from '@kos/wiki-engine';
import { runPipeline } from './pipeline.js';
import { runExtraction } from './extraction.js';
import { runWikiCompile } from './wiki.js';
import { reconcileOnce, type ReconcileQueue } from './reconcile.js';
import { runRetention } from './retention.js';

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

const storedEmbedding = await loadProviderSettings(prisma, env.APP_ENCRYPTION_KEY, 'embedding');
const embeddingModel = storedEmbedding?.model ?? env.EMBEDDING_MODEL;
const embeddingDim = storedEmbedding?.dim ?? env.EMBEDDING_DIM;
const qdrant = new QdrantStore({
  url: env.QDRANT_URL,
  ...(env.QDRANT_API_KEY ? { apiKey: env.QDRANT_API_KEY } : {}),
  collection: collectionName(embeddingModel, embeddingDim),
  vectorSize: embeddingDim,
});

const documents = new DocumentRepository(prisma);
const chunks = new ChunkRepository(prisma);
const wiki = new WikiRepository(prisma);
const extractionRepository = new ExtractionRepository(prisma);
const embeddings = createEmbeddingProvider(env, storedEmbedding);

const deps = {
  prisma,
  documents,
  chunks,
  jobs: new JobRepository(prisma),
  storage: new LocalStorageAdapter(resolveDataDir(env.DATA_DIR, import.meta.url)),
  embeddings,
  qdrant,
};

const storedChat = await loadProviderSettings(prisma, env.APP_ENCRYPTION_KEY, 'llm');
const chat = createChatProvider(env, storedChat);
const usingFakeChat = chat.model === 'fake-chat';

const extractionModel: ExtractionModel = usingFakeChat
  ? new FakeExtractionModel()
  : {
      model: chat.model,
      complete: async (messages) => ({ text: (await chat.complete(messages)).text }),
    };
const compileModel: CompileModel = usingFakeChat
  ? new FakeCompileModel()
  : {
      model: chat.model,
      complete: async (messages) => ({ text: (await chat.complete(messages)).text }),
    };

const extractQueue = createDocumentQueue(env.REDIS_URL, EXTRACT_QUEUE);
const wikiQueue = createDocumentQueue(env.REDIS_URL, WIKI_COMPILE_QUEUE);

const worker = createIngestWorker(
  env.REDIS_URL,
  async (job) => {
    await runPipeline(deps, job.data.jobId);
    const version = await documents.getVersionById(job.data.versionId);
    if (version?.status !== 'ready') {
      return;
    }
    await wiki.markPagesStaleForDocument(job.data.documentId, job.data.versionId);
    await enqueueDocument(extractQueue, 'extract', {
      jobId: `extract-${job.data.versionId}`,
      documentId: job.data.documentId,
      versionId: job.data.versionId,
    });
  },
  { concurrency: await loadConcurrency() },
);

worker.on('failed', (job, error) => {
  console.error('ingest job failed', job?.id, error);
});

const extractWorker = createDocumentWorker(
  env.REDIS_URL,
  EXTRACT_QUEUE,
  async (job) => {
    const budget = await prisma.appSetting.findUnique({
      where: { key: 'extraction.tokenBudget' },
    });
    const summary = await runExtraction(
      {
        prisma,
        chunks,
        extraction: extractionRepository,
        model: extractionModel,
        ...(typeof budget?.value === 'number' ? { tokenBudget: budget.value } : {}),
      },
      { versionId: job.data.versionId },
    );
    console.log('extraction result', summary);
    await enqueueDocument(wikiQueue, 'wiki_compile', {
      jobId: `wiki-${job.data.versionId}`,
      documentId: job.data.documentId,
      versionId: job.data.versionId,
    });
  },
  { concurrency: 1 },
);

extractWorker.on('failed', (job, error) => {
  console.error('extract job failed', job?.id, error);
});

const wikiWorker = createDocumentWorker(
  env.REDIS_URL,
  WIKI_COMPILE_QUEUE,
  async (job) => {
    const summary = await runWikiCompile(
      { prisma, chunks, wiki, embeddings, model: compileModel },
      { versionId: job.data.versionId },
    );
    console.log('wiki compile result', summary);
  },
  { concurrency: 1 },
);

wikiWorker.on('failed', (job, error) => {
  console.error('wiki compile job failed', job?.id, error);
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

async function retention(): Promise<void> {
  try {
    const result = await runRetention(deps);
    if (result.documents > 0 || result.retrievalRuns > 0) {
      console.warn('retention result', result);
    }
  } catch (error) {
    console.error('retention failed', error);
  }
}

const retentionTimer = setInterval(
  () => {
    void retention();
  },
  24 * 60 * 60 * 1000,
);
void retention();

async function shutdown(signal: string): Promise<void> {
  console.warn(`worker shutting down on ${signal}`);
  clearInterval(reconcileTimer);
  clearInterval(retentionTimer);
  await worker.close();
  await extractWorker.close();
  await wikiWorker.close();
  await ingestQueue.close();
  await extractQueue.close();
  await wikiQueue.close();
  await prisma.$disconnect();
  process.exit(0);
}

process.on('SIGINT', () => {
  void shutdown('SIGINT');
});
process.on('SIGTERM', () => {
  void shutdown('SIGTERM');
});
