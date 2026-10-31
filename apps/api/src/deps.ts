import { Redis } from 'ioredis';
import {
  ChunkRepository,
  ConversationRepository,
  createPrismaClient,
  DocumentRepository,
  JobRepository,
  type PrismaClient,
} from '@kos/database';
import { collectionName, createEmbeddingProvider } from '@kos/embeddings';
import { createChatProvider } from '@kos/llm';
import { cancelIngest, createIngestQueue, enqueueIngest, retryIngest } from '@kos/queue';
import { QdrantStore, RetrievalService } from '@kos/retrieval';
import type { Env } from '@kos/shared';
import { LocalStorageAdapter, type StorageAdapter } from '@kos/storage';
import { DocumentService, type IngestEnqueuer } from './modules/documents/document-service.js';
import { createUrlFetcher, type UrlFetcher } from './modules/documents/url-fetcher.js';
import { JobService } from './modules/jobs/job-service.js';
import { ConversationService } from './modules/conversations/conversation-service.js';

export interface Pingable {
  ping(): Promise<void>;
}

export interface Closable {
  close(): Promise<void>;
}

export interface AppDeps {
  env: Env;
  db: Pingable & Closable;
  redis: Pingable & Closable;
  qdrant: Pingable;
  prisma: PrismaClient;
  storage: StorageAdapter;
  queue: Closable;
  documents: DocumentService;
  jobs: JobService;
  retrieval: RetrievalService;
  conversations: ConversationService;
  urlFetcher: UrlFetcher;
}

export function createDeps(env: Env): AppDeps {
  const prisma = createPrismaClient(env.DATABASE_URL);
  const storage = new LocalStorageAdapter(env.DATA_DIR);
  const queue = createIngestQueue(env.REDIS_URL);

  const enqueue: IngestEnqueuer = async (data) => {
    try {
      await enqueueIngest(queue, data);
    } catch (error) {
      // 任务行已落库，入队失败时由对账任务补投，不阻塞导入响应。
      console.error('failed to enqueue ingest job', data.jobId, error);
    }
  };

  const documents = new DocumentService(new DocumentRepository(prisma), storage, enqueue);
  const jobs = new JobService(prisma, new JobRepository(prisma), {
    retry: async (data) => {
      await retryIngest(queue, data);
    },
    cancel: (jobId) => cancelIngest(queue, jobId),
  });
  const qdrantStore = new QdrantStore({
    url: env.QDRANT_URL,
    ...(env.QDRANT_API_KEY ? { apiKey: env.QDRANT_API_KEY } : {}),
    collection: collectionName(env.EMBEDDING_MODEL, env.EMBEDDING_DIM),
    vectorSize: env.EMBEDDING_DIM,
  });
  const retrieval = new RetrievalService({
    prisma,
    embeddings: createEmbeddingProvider(env),
    qdrant: qdrantStore,
  });
  const conversations = new ConversationService(
    prisma,
    new ConversationRepository(prisma),
    new ChunkRepository(prisma),
    retrieval,
    createChatProvider(env),
  );
  const urlFetcher = createUrlFetcher();

  const redis = new Redis(env.REDIS_URL, {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    connectTimeout: 3000,
  });

  // Health checks report connection failures through ping(); keep the process
  // alive instead of letting ioredis emit an unhandled error event.
  redis.on('error', () => undefined);

  return {
    env,
    prisma,
    storage,
    queue,
    documents,
    jobs,
    retrieval,
    conversations,
    urlFetcher,
    db: {
      async ping() {
        await prisma.$queryRaw`SELECT 1`;
      },
      async close() {
        await prisma.$disconnect();
      },
    },
    redis: {
      async ping() {
        if (redis.status === 'wait' || redis.status === 'end') {
          await redis.connect();
        }
        await redis.ping();
      },
      async close() {
        await redis.quit();
      },
    },
    qdrant: {
      async ping() {
        const response = await fetch(new URL('/healthz', env.QDRANT_URL), {
          headers: env.QDRANT_API_KEY ? { 'api-key': env.QDRANT_API_KEY } : {},
          signal: AbortSignal.timeout(3000),
        });
        if (!response.ok) {
          throw new Error(`Qdrant health check failed with status ${response.status}`);
        }
      },
    },
  };
}
