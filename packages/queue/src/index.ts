import { Queue, Worker, type Job, type RedisOptions } from 'bullmq';

export const INGEST_QUEUE = 'kos-ingest';

export interface IngestJobData {
  jobId: string;
  documentId: string;
  versionId: string;
}

export type IngestProcessor = (job: Job<IngestJobData>) => Promise<void>;

export function redisConnectionOptions(redisUrl: string): RedisOptions {
  const url = new URL(redisUrl);
  const db = url.pathname.replace(/^\//, '');

  return {
    host: url.hostname || '127.0.0.1',
    port: url.port ? Number(url.port) : 6379,
    ...(url.username ? { username: decodeURIComponent(url.username) } : {}),
    ...(url.password ? { password: decodeURIComponent(url.password) } : {}),
    ...(db ? { db: Number(db) } : {}),
    // BullMQ 阻塞命令要求该项为 null，否则空闲连接会被 ioredis 主动断开。
    maxRetriesPerRequest: null,
  };
}

export function createIngestQueue(redisUrl: string, name = INGEST_QUEUE): Queue<IngestJobData> {
  return new Queue<IngestJobData>(name, { connection: redisConnectionOptions(redisUrl) });
}

export function createIngestWorker(
  redisUrl: string,
  processor: IngestProcessor,
  options: { name?: string; concurrency?: number } = {},
): Worker<IngestJobData> {
  return new Worker<IngestJobData>(options.name ?? INGEST_QUEUE, processor, {
    connection: redisConnectionOptions(redisUrl),
    concurrency: options.concurrency ?? 2,
  });
}

export async function retryIngest(
  queue: Queue<IngestJobData>,
  data: IngestJobData,
): Promise<string> {
  const existing = await queue.getJob(data.jobId);
  if (existing) {
    // 失败任务默认保留在 Redis，重试前先移除同 ID 的旧任务。
    await existing.remove();
  }
  return enqueueIngest(queue, data);
}

export async function cancelIngest(queue: Queue<IngestJobData>, jobId: string): Promise<void> {
  const existing = await queue.getJob(jobId);
  if (existing) {
    await existing.remove();
  }
}

export async function enqueueIngest(
  queue: Queue<IngestJobData>,
  data: IngestJobData,
): Promise<string> {
  // jobId 复用业务任务 ID，重复入队成为幂等操作。
  const job = await queue.add('ingest', data, {
    jobId: data.jobId,
    attempts: 1,
    removeOnComplete: 100,
    removeOnFail: 500,
  });

  return job.id ?? data.jobId;
}
