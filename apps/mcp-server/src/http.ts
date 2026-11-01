import { readFileSync } from 'node:fs';
import {
  createServer as createHttpServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { McpServerConfig } from './config.js';
import { KosApiClient } from './client.js';
import { createKosServer } from './server.js';

const MAX_BODY_BYTES = 1024 * 1024;

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(text),
  });
  response.end(text);
}

function readBody(request: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    request.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error('请求体超过 1MB 上限'));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8');
      try {
        resolve(text ? JSON.parse(text) : undefined);
      } catch {
        reject(new Error('请求体不是合法 JSON'));
      }
    });
    request.on('error', reject);
  });
}

function originAllowed(origin: string, allowed: string[] | undefined): boolean {
  if (allowed?.length) {
    return allowed.includes(origin);
  }
  try {
    const url = new URL(origin);
    return url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '::1';
  } catch {
    return false;
  }
}

export function startHttpServer(
  config: McpServerConfig,
  host: string,
  port: number,
): Promise<void> {
  const handler = async (request: IncomingMessage, response: ServerResponse) => {
    if (request.method === 'GET' && request.url === '/healthz') {
      response.writeHead(200, { 'content-type': 'text/plain' });
      response.end('ok');
      return;
    }

    if (request.method !== 'POST' || request.url !== '/mcp') {
      sendJson(response, 404, { error: 'not_found' });
      return;
    }

    const origin = request.headers.origin;
    if (origin && !originAllowed(origin, config.allowedOrigins)) {
      sendJson(response, 403, { error: 'origin_not_allowed' });
      return;
    }

    const header = request.headers.authorization;
    const token =
      header?.startsWith('Bearer ') && header.slice('Bearer '.length).trim()
        ? header.slice('Bearer '.length).trim()
        : config.token;
    if (!token) {
      sendJson(response, 401, { error: 'missing_token' });
      return;
    }

    let body: unknown;
    try {
      body = await readBody(request);
    } catch (error) {
      sendJson(response, 400, {
        error: 'invalid_body',
        message: error instanceof Error ? error.message : '请求体不合法',
      });
      return;
    }

    const server = createKosServer(
      new KosApiClient({ apiUrl: config.apiUrl, token, transport: 'http' }),
    );
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });

    response.on('close', () => {
      void transport.close();
      void server.close();
    });

    try {
      await server.connect(transport);
      await transport.handleRequest(request, response, body);
    } catch (error) {
      if (!response.headersSent) {
        sendJson(response, 500, {
          jsonrpc: '2.0',
          error: {
            code: -32603,
            message: error instanceof Error ? error.message : 'MCP 处理失败',
          },
          id: null,
        });
      }
    }
  };

  const server = config.tls
    ? createHttpsServer(
        {
          cert: readFileSync(config.tls.certFile),
          key: readFileSync(config.tls.keyFile),
        },
        (request, response) => void handler(request, response),
      )
    : createHttpServer((request, response) => void handler(request, response));

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      const scheme = config.tls ? 'https' : 'http';
      console.error(`KnowledgeOS MCP Server listening on ${scheme}://${host}:${port}/mcp`);
      resolve();
    });
  });
}
