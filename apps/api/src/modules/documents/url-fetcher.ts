import { lookup as dnsLookup } from 'node:dns/promises';
import http, { type IncomingHttpHeaders } from 'node:http';
import https from 'node:https';
import type { LookupFunction } from 'node:net';
import ipaddr from 'ipaddr.js';
import { ApiError } from '@kos/shared';

const MAX_REDIRECTS = 5;
const MAX_BODY_BYTES = 10 * 1024 * 1024;
const CONNECT_TIMEOUT_MS = 5_000;
const TOTAL_TIMEOUT_MS = 20_000;
const ALLOWED_MIME_TYPES = new Set(['text/html', 'text/plain', 'application/pdf']);

export interface FetchedUrl {
  finalUrl: string;
  mimeType: string;
  buffer: Buffer;
}

export interface UrlFetcher {
  fetch(url: string): Promise<FetchedUrl>;
}

interface RawResponse {
  statusCode: number;
  headers: IncomingHttpHeaders;
  body: Buffer;
}

export function isPublicAddress(address: string): boolean {
  try {
    let parsed = ipaddr.parse(address);
    if (parsed.kind() === 'ipv6' && (parsed as ipaddr.IPv6).isIPv4MappedAddress()) {
      parsed = (parsed as ipaddr.IPv6).toIPv4Address();
    }
    return parsed.range() === 'unicast';
  } catch {
    return false;
  }
}

async function resolveAndValidate(
  input: string,
): Promise<{ url: URL; address: string; family: 4 | 6 }> {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new ApiError('INVALID_ARGUMENT', 'URL 格式不合法');
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new ApiError('SSRF_BLOCKED', '仅允许 http/https URL');
  }
  if (url.username || url.password) {
    throw new ApiError('SSRF_BLOCKED', 'URL 不允许包含凭证');
  }

  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  if (!hostname) {
    throw new ApiError('SSRF_BLOCKED', 'URL 缺少主机名');
  }

  let addresses: Array<{ address: string; family: number }>;
  try {
    addresses = await dnsLookup(hostname, { all: true, verbatim: true });
  } catch {
    throw new ApiError('FETCH_FAILED', '域名解析失败');
  }

  if (addresses.length === 0) {
    throw new ApiError('FETCH_FAILED', '域名解析失败');
  }
  for (const entry of addresses) {
    if (!isPublicAddress(entry.address)) {
      throw new ApiError('SSRF_BLOCKED', 'URL 指向不允许的地址');
    }
  }

  const first = addresses[0];
  if (!first) {
    throw new ApiError('FETCH_FAILED', '域名解析失败');
  }

  return {
    url,
    address: first.address,
    family: first.family === 6 ? 6 : 4,
  };
}

function requestOnce(url: URL, address: string, family: 4 | 6): Promise<RawResponse> {
  return new Promise((resolve, reject) => {
    const transport = url.protocol === 'https:' ? https : http;
    const lookup: LookupFunction = (_hostname, options, callback) => {
      if (options.all) {
        callback(null, [{ address, family }]);
      } else {
        callback(null, address, family);
      }
    };

    const request = transport.request(
      url,
      {
        method: 'GET',
        headers: {
          'user-agent': 'KnowledgeOS/0.1',
          accept: 'text/html,text/plain,application/pdf',
        },
        lookup,
        timeout: CONNECT_TIMEOUT_MS,
      },
      (response) => {
        void (async () => {
          const statusCode = response.statusCode ?? 0;

          if (statusCode < 200 || statusCode >= 300) {
            response.resume();
            resolve({ statusCode, headers: response.headers, body: Buffer.alloc(0) });
            return;
          }

          const chunks: Buffer[] = [];
          let size = 0;

          for await (const chunk of response) {
            const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
            size += buffer.length;
            if (size > MAX_BODY_BYTES) {
              request.destroy(new ApiError('FILE_TOO_LARGE', '响应体超过 10MB'));
              return;
            }
            chunks.push(buffer);
          }

          resolve({
            statusCode,
            headers: response.headers,
            body: Buffer.concat(chunks),
          });
        })().catch(reject);
      },
    );

    const timer = setTimeout(() => {
      request.destroy(new ApiError('FETCH_FAILED', '请求超时'));
    }, TOTAL_TIMEOUT_MS);

    request.on('close', () => clearTimeout(timer));
    request.on('error', (error) => {
      clearTimeout(timer);
      reject(error instanceof ApiError ? error : new ApiError('FETCH_FAILED', '抓取远程内容失败'));
    });
    request.end();
  });
}

export async function fetchUrl(input: string): Promise<FetchedUrl> {
  let current = input;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const { url, address, family } = await resolveAndValidate(current);
    const response = await requestOnce(url, address, family);

    if (response.statusCode >= 300 && response.statusCode < 400) {
      const location = response.headers.location;
      if (!location) {
        throw new ApiError('FETCH_FAILED', '重定向缺少 Location');
      }
      current = new URL(location, url).toString();
      continue;
    }

    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw new ApiError('FETCH_FAILED', `上游返回 HTTP ${response.statusCode}`);
    }

    const contentTypeHeader = response.headers['content-type'];
    const contentType = Array.isArray(contentTypeHeader) ? contentTypeHeader[0] : contentTypeHeader;
    const mimeType = (contentType ?? '').split(';')[0]?.trim().toLowerCase() ?? '';

    if (!ALLOWED_MIME_TYPES.has(mimeType)) {
      throw new ApiError('UNSUPPORTED_FORMAT', `不支持的 Content-Type: ${mimeType || 'unknown'}`);
    }
    if (response.body.length === 0) {
      throw new ApiError('FETCH_FAILED', '响应正文为空');
    }

    return { finalUrl: url.toString(), mimeType, buffer: response.body };
  }

  throw new ApiError('FETCH_FAILED', '重定向次数过多');
}

export function createUrlFetcher(): UrlFetcher {
  return { fetch: fetchUrl };
}
