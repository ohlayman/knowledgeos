import { Redis } from 'ioredis';
import {
  AgentRepository,
  ChunkRepository,
  ConversationRepository,
  createPrismaClient,
  DocumentRepository,
  JobRepository,
  loadProviderSettings,
  McpTokenRepository,
  PrismaGraphStore,
  WikiRepository,
  type PrismaClient,
} from '@kos/database';
import { GraphService } from '@kos/graph';
import { collectionName, createEmbeddingProvider } from '@kos/embeddings';
import { createChatProvider, type ChatProvider } from '@kos/llm';
import {
  cancelIngest,
  createDocumentQueue,
  createIngestQueue,
  enqueueDocument,
  enqueueIngest,
  EXTRACT_QUEUE,
  retryIngest,
} from '@kos/queue';
import { QdrantStore, RetrievalService } from '@kos/retrieval';
import { normalizeEntityName, type Env } from '@kos/shared';
import { LocalStorageAdapter, resolveDataDir, type StorageAdapter } from '@kos/storage';
import { DocumentService, type IngestEnqueuer } from './modules/documents/document-service.js';
import { createUrlFetcher, type UrlFetcher } from './modules/documents/url-fetcher.js';
import { JobService } from './modules/jobs/job-service.js';
import { ConversationService } from './modules/conversations/conversation-service.js';
import { ChunkService } from './modules/chunks/chunk-service.js';
import { MaintenanceService } from './modules/maintenance/maintenance-service.js';
import { MetricsService } from './modules/metrics/metrics-service.js';
import { SettingsService } from './modules/settings/settings-service.js';
import { WikiService } from './modules/wiki/wiki-service.js';
import { createAgentService, type AgentService } from './modules/agents/agent-service.js';

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
  chunks: ChunkService;
  settings: SettingsService;
  metrics: MetricsService;
  maintenance: MaintenanceService;
  urlFetcher: UrlFetcher;
  wiki: WikiService;
  graph: GraphService;
  agents: AgentService;
  mcpTokens: McpTokenRepository;
  chatProvider: () => Promise<ChatProvider>;
}

export async function createDeps(env: Env): Promise<AppDeps> {
  const prisma = createPrismaClient(env.DATABASE_URL);
  const storage = new LocalStorageAdapter(resolveDataDir(env.DATA_DIR, import.meta.url));
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
  const storedEmbedding = await loadProviderSettings(prisma, env.APP_ENCRYPTION_KEY, 'embedding');
  const embeddingModel = storedEmbedding?.model ?? env.EMBEDDING_MODEL;
  const embeddingDim = storedEmbedding?.dim ?? env.EMBEDDING_DIM;
  const qdrantStore = new QdrantStore({
    url: env.QDRANT_URL,
    ...(env.QDRANT_API_KEY ? { apiKey: env.QDRANT_API_KEY } : {}),
    collection: collectionName(embeddingModel, embeddingDim),
    vectorSize: embeddingDim,
  });
  const graph = new GraphService(new PrismaGraphStore(prisma));
  const graphPort = {
    searchPaths: async (entityNames: string[], maxHops = 3) => {
      const entities = await prisma.entity.findMany({
        where: {
          status: 'active',
          normalizedName: {
            in: entityNames.map((name) => normalizeEntityName(name)).filter(Boolean),
          },
        },
        select: { id: true, canonicalName: true },
      });
      if (entities.length < 2) {
        return [];
      }
      const paths = await graph.paths(entities[0]!.id, entities[1]!.id, maxHops, 5);
      return paths.map((path) => ({
        nodeNames: path.nodes.map((node) => node.name),
        edges: path.edges.map((edge) => ({
          from: path.nodes.find((node) => node.id === edge.fromId)?.name ?? edge.fromId,
          to: path.nodes.find((node) => node.id === edge.toId)?.name ?? edge.toId,
          type: edge.type,
          confidence: edge.confidence,
          evidenceChunkIds: edge.evidenceChunkIds,
        })),
        chunkIds: path.chunkIds,
        score: path.score,
        scoreBreakdown: path.scoreBreakdown,
      }));
    },
  };
  const retrieval = new RetrievalService({
    prisma,
    embeddings: createEmbeddingProvider(env, storedEmbedding),
    qdrant: qdrantStore,
    graph: graphPort,
  });
  const chatProvider = async () =>
    createChatProvider(env, await loadProviderSettings(prisma, env.APP_ENCRYPTION_KEY, 'llm'));
  const conversations = new ConversationService(
    prisma,
    new ConversationRepository(prisma),
    new ChunkRepository(prisma),
    retrieval,
    chatProvider,
  );
  const chunks = new ChunkService(prisma, new ChunkRepository(prisma));
  const settings = new SettingsService(prisma, env);
  const metrics = new MetricsService(prisma, queue);
  const maintenance = new MaintenanceService(prisma, storage, qdrantStore);
  const urlFetcher = createUrlFetcher();
  const extractQueue = createDocumentQueue(env.REDIS_URL, EXTRACT_QUEUE);
  const wikiRepository = new WikiRepository(prisma);
  const wiki = new WikiService(prisma, wikiRepository, async (input) => {
    await enqueueDocument(extractQueue, 'extract', {
      jobId: `extract-${input.versionId}-${Date.now()}`,
      documentId: input.documentId,
      versionId: input.versionId,
    });
  });
  const mcpTokens = new McpTokenRepository(prisma);
  const agents = createAgentService({
    prisma,
    agents: new AgentRepository(prisma),
    wiki: wikiRepository,
    retrieval,
    graph,
    chatProvider,
  });

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
    chunks,
    settings,
    metrics,
    maintenance,
    urlFetcher,
    wiki,
    graph,
    agents,
    mcpTokens,
    chatProvider,
    db: {
      async ping() {
        await prisma.$queryRaw`SELECT 1`;
      },
      async close() {
        await extractQueue.close();
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
