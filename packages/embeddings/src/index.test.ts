import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { describe, expect, it } from 'vitest';
import { ApiError } from '@kos/shared';
import { FakeEmbeddingProvider } from './fake.js';
import { OpenAICompatibleEmbeddingProvider } from './openai.js';

async function withServer(
  handler: (request: IncomingMessage, response: ServerResponse, body: string) => void,
  run: (baseUrl: string) => Promise<void>,
): Promise<void> {
  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => {
      handler(request, response, Buffer.concat(chunks).toString('utf8'));
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;

  try {
    await run(`http://127.0.0.1:${port}/v1`);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

describe('FakeEmbeddingProvider', () => {
  it('相同文本得到相同向量，不同文本不同', async () => {
    const provider = new FakeEmbeddingProvider(8);

    const [a, b, c] = await provider.embed(['甲', '甲', '乙']);

    expect(a).toEqual(b);
    expect(a).not.toEqual(c);
    expect(a).toHaveLength(8);
  });

  it('向量已归一化', async () => {
    const provider = new FakeEmbeddingProvider(16);
    const [vector] = await provider.embed(['归一化检查']);
    const norm = Math.sqrt(vector!.reduce((sum, value) => sum + value * value, 0));

    expect(norm).toBeCloseTo(1, 5);
  });
});

describe('OpenAICompatibleEmbeddingProvider', () => {
  it('按批次调用并携带鉴权头', async () => {
    const requests: Array<{ authorization?: string; input: string[] }> = [];

    await withServer(
      (request, response, body) => {
        const payload = JSON.parse(body) as { input: string[] };
        requests.push({
          authorization: request.headers.authorization,
          input: payload.input,
        });
        response.setHeader('content-type', 'application/json');
        response.end(
          JSON.stringify({
            data: payload.input.map((_, index) => ({ embedding: [index, 1] })),
          }),
        );
      },
      async (baseUrl) => {
        const provider = new OpenAICompatibleEmbeddingProvider({
          baseUrl,
          apiKey: 'test-key',
          model: 'text-embedding-test',
          dim: 2,
          batchSize: 2,
        });

        const vectors = await provider.embed(['a', 'b', 'c']);

        expect(vectors).toHaveLength(3);
        expect(requests).toHaveLength(2);
        expect(requests[0]?.authorization).toBe('Bearer test-key');
        expect(requests[0]?.input).toEqual(['a', 'b']);
        expect(requests[1]?.input).toEqual(['c']);
      },
    );
  });

  it('5xx 之后重试成功', async () => {
    let calls = 0;

    await withServer(
      (_request, response) => {
        calls += 1;
        if (calls === 1) {
          response.statusCode = 500;
          response.end('boom');
          return;
        }
        response.setHeader('content-type', 'application/json');
        response.end(JSON.stringify({ data: [{ embedding: [1, 0] }] }));
      },
      async (baseUrl) => {
        const provider = new OpenAICompatibleEmbeddingProvider({
          baseUrl,
          apiKey: 'test-key',
          model: 'm',
          dim: 2,
          retryDelaysMs: [0, 0, 0],
        });

        const [vector] = await provider.embed(['a']);

        expect(vector).toEqual([1, 0]);
        expect(calls).toBe(2);
      },
    );
  });

  it('4xx 不重试并抛出 INVALID_ARGUMENT', async () => {
    let calls = 0;

    await withServer(
      (_request, response) => {
        calls += 1;
        response.statusCode = 400;
        response.end('bad request');
      },
      async (baseUrl) => {
        const provider = new OpenAICompatibleEmbeddingProvider({
          baseUrl,
          apiKey: 'test-key',
          model: 'm',
          dim: 2,
          retryDelaysMs: [0],
        });

        await expect(provider.embed(['a'])).rejects.toBeInstanceOf(ApiError);
        await expect(provider.embed(['a'])).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
        expect(calls).toBe(2);
      },
    );
  });

  it('响应维度不符时报错', async () => {
    await withServer(
      (_request, response) => {
        response.setHeader('content-type', 'application/json');
        response.end(JSON.stringify({ data: [{ embedding: [1] }] }));
      },
      async (baseUrl) => {
        const provider = new OpenAICompatibleEmbeddingProvider({
          baseUrl,
          apiKey: 'test-key',
          model: 'm',
          dim: 2,
        });

        await expect(provider.embed(['a'])).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
      },
    );
  });
});
