import { randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createPrismaClient } from '@kos/database';
import type { Env } from '@kos/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SettingsService } from './settings-service.js';

const enabled = process.env.RUN_DB_INTEGRATION === '1' && Boolean(process.env.DATABASE_URL);
const prisma = createPrismaClient(process.env.DATABASE_URL);
const model = `test-model-${randomUUID().slice(0, 8)}`;
const encryptionKey = 'integration-test-key';

const env = {
  NODE_ENV: 'test',
  HOST: '127.0.0.1',
  PORT: 3000,
  WEB_ORIGIN: 'http://localhost:5173',
  DATABASE_URL: process.env.DATABASE_URL ?? '',
  REDIS_URL: 'redis://localhost:6379',
  QDRANT_URL: 'http://localhost:6333',
  DATA_DIR: './data',
  EMBEDDING_MODEL: 'text-embedding-3-small',
  EMBEDDING_DIM: 2,
  APP_ENCRYPTION_KEY: encryptionKey,
  LOG_LEVEL: 'fatal',
} as Env;

const service = new SettingsService(prisma, env);
let server: ReturnType<typeof createServer>;
let baseUrl = '';

describe.skipIf(!enabled)('SettingsService', () => {
  beforeAll(async () => {
    server = createServer((request: IncomingMessage, response: ServerResponse) => {
      void (async () => {
        for await (const chunk of request) {
          // 测试服务不读取请求体，仅消费流
          if (!chunk) {
            break;
          }
        }
        if (request.url?.includes('/bad/')) {
          response.statusCode = 401;
          response.end('invalid api key: sk-secret-value');
          return;
        }
        response.setHeader('content-type', 'application/json');
        response.end(JSON.stringify({ data: [{ embedding: [0.1, 0.2] }] }));
      })();
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await prisma.providerConfig.deleteMany({ where: { model } });
    await prisma.appSetting
      .update({
        where: { key: 'retrieval.topK' },
        data: { value: 10 },
      })
      .catch(() => undefined);
    await prisma.$disconnect();
  });

  it('stores provider keys encrypted and never returns them', async () => {
    const overview = await service.saveProvider('llm', {
      provider: 'openai',
      model,
      baseUrl,
      apiKey: 'sk-secret-value-1234',
    });

    const provider = overview.providers.find((row) => row.model === model);
    expect(provider?.apiKeyLast4).toBe('1234');
    expect(provider?.isActive).toBe(true);

    const serialized = JSON.stringify(overview);
    expect(serialized).not.toContain('sk-secret-value-1234');

    const row = await prisma.providerConfig.findFirst({ where: { model } });
    expect(row?.apiKeyEncrypted).toBeTruthy();
    expect(row?.apiKeyEncrypted).not.toContain('sk-secret-value-1234');
  });

  it('updates allow-listed settings', async () => {
    const overview = await service.update({ settings: { 'retrieval.topK': 7 } });

    expect(overview.settings['retrieval.topK']).toBe(7);
  });

  it('tests an embedding endpoint successfully', async () => {
    const result = await service.testConnection({
      kind: 'embedding',
      baseUrl,
      model,
      apiKey: 'test-key',
      dim: 2,
    });

    expect(result.ok).toBe(true);
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('reports failures without leaking the provider response body', async () => {
    const result = await service.testConnection({
      kind: 'embedding',
      baseUrl: `${baseUrl.replace('/v1', '/bad/v1')}`,
      model,
      apiKey: 'wrong-key',
      dim: 2,
    });

    expect(result.ok).toBe(false);
    expect(result).not.toHaveProperty('body');
    expect(JSON.stringify(result)).not.toContain('sk-secret-value');
  });
});
