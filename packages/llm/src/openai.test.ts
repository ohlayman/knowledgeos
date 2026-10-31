import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { describe, expect, it } from 'vitest';
import { ApiError } from '@kos/shared';
import { FakeChatProvider } from './fake.js';
import { OpenAICompatibleChatProvider } from './openai.js';

async function withServer(
  handler: (request: IncomingMessage, response: ServerResponse, body: string) => void,
  run: (baseUrl: string) => Promise<void>,
): Promise<void> {
  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => handler(request, response, Buffer.concat(chunks).toString('utf8')));
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;

  try {
    await run(`http://127.0.0.1:${port}/v1`);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

function sse(...chunks: unknown[]): string {
  return `${chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join('')}data: [DONE]\n\n`;
}

describe('OpenAICompatibleChatProvider', () => {
  it('解析 SSE 增量并回报用量', async () => {
    const usageSeen: Array<{ inputTokens?: number; outputTokens?: number }> = [];

    await withServer(
      (request, response, body) => {
        const payload = JSON.parse(body) as { stream?: boolean; messages: unknown[] };
        expect(payload.stream).toBe(true);
        expect(request.headers.authorization).toBe('Bearer test-key');
        expect(payload.messages).toHaveLength(2);

        response.setHeader('content-type', 'text/event-stream');
        response.end(
          sse(
            { choices: [{ delta: { content: '混合' } }] },
            { choices: [{ delta: { content: '检索' } }] },
            { choices: [], usage: { prompt_tokens: 12, completion_tokens: 2 } },
          ),
        );
      },
      async (baseUrl) => {
        const provider = new OpenAICompatibleChatProvider({
          baseUrl,
          apiKey: 'test-key',
          model: 'test-chat',
        });

        const parts: string[] = [];
        for await (const delta of provider.stream(
          [
            { role: 'system', content: 's' },
            { role: 'user', content: 'u' },
          ],
          { onUsage: (usage) => usageSeen.push(usage) },
        )) {
          parts.push(delta);
        }

        expect(parts.join('')).toBe('混合检索');
        expect(usageSeen).toEqual([{ inputTokens: 12, outputTokens: 2 }]);
      },
    );
  });

  it('首个 token 前的 5xx 会重试', async () => {
    let calls = 0;

    await withServer(
      (_request, response) => {
        calls += 1;
        if (calls === 1) {
          response.statusCode = 503;
          response.end('busy');
          return;
        }
        response.setHeader('content-type', 'text/event-stream');
        response.end(sse({ choices: [{ delta: { content: 'ok' } }] }));
      },
      async (baseUrl) => {
        const provider = new OpenAICompatibleChatProvider({
          baseUrl,
          apiKey: 'test-key',
          model: 'm',
          retryDelaysMs: [0],
        });

        const parts: string[] = [];
        for await (const delta of provider.stream([{ role: 'user', content: 'q' }])) {
          parts.push(delta);
        }

        expect(parts.join('')).toBe('ok');
        expect(calls).toBe(2);
      },
    );
  });

  it('4xx 不重试并抛 INVALID_ARGUMENT', async () => {
    let calls = 0;

    await withServer(
      (_request, response) => {
        calls += 1;
        response.statusCode = 400;
        response.end('bad');
      },
      async (baseUrl) => {
        const provider = new OpenAICompatibleChatProvider({
          baseUrl,
          apiKey: 'k',
          model: 'm',
          retryDelaysMs: [0],
        });

        await expect(
          (async () => {
            let emitted = 0;
            for await (const delta of provider.stream([{ role: 'user', content: 'q' }])) {
              emitted += delta.length;
            }
            expect(emitted).toBe(0);
          })(),
        ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
        expect(calls).toBe(1);
        expect(new ApiError('INVALID_ARGUMENT').code).toBe('INVALID_ARGUMENT');
      },
    );
  });

  it('complete 返回文本与用量', async () => {
    await withServer(
      (_request, response) => {
        response.setHeader('content-type', 'application/json');
        response.end(
          JSON.stringify({
            choices: [{ message: { content: '完成' } }],
            usage: { prompt_tokens: 5, completion_tokens: 2 },
          }),
        );
      },
      async (baseUrl) => {
        const provider = new OpenAICompatibleChatProvider({ baseUrl, apiKey: 'k', model: 'm' });
        const result = await provider.complete([{ role: 'user', content: 'q' }]);

        expect(result.text).toBe('完成');
        expect(result.usage).toEqual({ inputTokens: 5, outputTokens: 2 });
      },
    );
  });
});

describe('FakeChatProvider', () => {
  it('流式输出可合并为完整文本', async () => {
    const provider = new FakeChatProvider({ reply: () => '固定回答 [1]', chunkSize: 3 });
    const parts: string[] = [];
    for await (const delta of provider.stream([{ role: 'user', content: 'q' }])) {
      parts.push(delta);
    }

    expect(parts.join('')).toBe('固定回答 [1]');
    expect(parts.length).toBeGreaterThan(1);
  });
});
