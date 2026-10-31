import { Redis } from 'ioredis';
import { createPrismaClient, DocumentRepository, type PrismaClient } from '@kos/database';
import type { Env } from '@kos/shared';
import { LocalStorageAdapter, type StorageAdapter } from '@kos/storage';
import { DocumentService } from './modules/documents/document-service.js';
import { createUrlFetcher, type UrlFetcher } from './modules/documents/url-fetcher.js';

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
  documents: DocumentService;
  urlFetcher: UrlFetcher;
}

export function createDeps(env: Env): AppDeps {
  const prisma = createPrismaClient(env.DATABASE_URL);
  const storage = new LocalStorageAdapter(env.DATA_DIR);
  const documents = new DocumentService(new DocumentRepository(prisma), storage);
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
    documents,
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
