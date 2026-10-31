import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  createIngestQueue,
  createIngestWorker,
  enqueueIngest,
  redisConnectionOptions,
} from './index.js';

describe('redisConnectionOptions', () => {
  it('解析主机、端口、密码与数据库', () => {
    const options = redisConnectionOptions('redis://:secret@example.test:6380/2');

    expect(options).toMatchObject({
      host: 'example.test',
      port: 6380,
      password: 'secret',
      db: 2,
      maxRetriesPerRequest: null,
    });
  });

  it('缺省时使用 6379 与 0 号库', () => {
    const options = redisConnectionOptions('redis://localhost');

    expect(options.host).toBe('localhost');
    expect(options.port).toBe(6379);
    expect(options.db).toBeUndefined();
  });
});

const enabled = process.env.RUN_DB_INTEGRATION === '1' && Boolean(process.env.REDIS_URL);

describe.skipIf(!enabled)('ingest queue', () => {
  it('入队后由 worker 处理，重连后任务仍在', async () => {
    const redisUrl = process.env.REDIS_URL!;
    const queueName = `kos-test-${randomUUID().slice(0, 8)}`;
    const jobId = randomUUID();
    const queue = createIngestQueue(redisUrl, queueName);

    await enqueueIngest(queue, { jobId, documentId: 'doc-1', versionId: 'ver-1' });
    expect(await queue.getJob(jobId)).toBeTruthy();

    const seen: string[] = [];
    const worker = createIngestWorker(
      redisUrl,
      async (job) => {
        seen.push(job.data.jobId);
      },
      { name: queueName, concurrency: 1 },
    );

    const deadline = Date.now() + 10_000;
    while (seen.length === 0 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    expect(seen).toContain(jobId);

    await worker.close();
    await queue.close();
  });
});
