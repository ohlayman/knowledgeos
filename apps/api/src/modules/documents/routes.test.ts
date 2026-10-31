import FormData from 'form-data';
import { ApiError } from '@kos/shared';
import { describe, expect, it, vi } from 'vitest';
import type { AppDeps } from '../../deps.js';
import { buildApp } from '../../app.js';

interface UploadFile {
  name: string;
  type: string;
  buffer: Buffer;
}

function fakeDeps(): AppDeps {
  return {
    env: {
      NODE_ENV: 'test',
      HOST: '127.0.0.1',
      PORT: 3000,
      WEB_ORIGIN: 'http://localhost:5173',
      DATABASE_URL: 'postgresql://user:pass@localhost:5432/knowledgeos',
      REDIS_URL: 'redis://localhost:6379',
      QDRANT_URL: 'http://localhost:6333',
      DATA_DIR: './data',
      LOG_LEVEL: 'fatal',
    },
    db: {
      ping: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
    },
    redis: {
      ping: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
    },
    qdrant: {
      ping: vi.fn().mockResolvedValue(undefined),
    },
    prisma: {} as AppDeps['prisma'],
    storage: {} as AppDeps['storage'],
    documents: {
      ingestFile: vi.fn(),
      ingestText: vi.fn(),
      ingestUrl: vi.fn(),
    } as unknown as AppDeps['documents'],
    urlFetcher: {
      fetch: vi.fn(),
    } as unknown as AppDeps['urlFetcher'],
  };
}

function multipart(files: UploadFile[], fields: Record<string, string> = {}) {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    form.append(key, value);
  }
  for (const file of files) {
    form.append('files', file.buffer, {
      filename: file.name,
      contentType: file.type,
    });
  }
  return { payload: form.getBuffer(), headers: form.getHeaders() };
}

describe('POST /api/v1/documents/files', () => {
  it('uploads a markdown file and returns a queued item', async () => {
    const deps = fakeDeps();
    vi.mocked(deps.documents.ingestFile).mockResolvedValue({
      status: 'queued',
      documentId: 'doc-1',
      versionId: 'ver-1',
      jobId: 'job-1',
    });
    const app = buildApp(deps);
    const body = multipart(
      [{ name: 'notes.md', type: 'text/markdown', buffer: Buffer.from('# Hello\n') }],
      { tags: 'rag,test' },
    );

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/documents/files',
      headers: body.headers,
      payload: body.payload,
    });

    expect(response.statusCode).toBe(202);
    expect(response.json()).toEqual({
      items: [
        {
          fileName: 'notes.md',
          status: 'queued',
          documentId: 'doc-1',
          versionId: 'ver-1',
          jobId: 'job-1',
        },
      ],
    });
    expect(deps.documents.ingestFile).toHaveBeenCalledWith(
      expect.objectContaining({
        fileName: 'notes.md',
        mimeType: 'text/markdown',
        tags: ['rag', 'test'],
      }),
    );
    await app.close();
  });

  it('rejects a disguised executable based on its magic bytes', async () => {
    const deps = fakeDeps();
    const app = buildApp(deps);
    const body = multipart([
      {
        name: 'notes.md',
        type: 'text/markdown',
        buffer: Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00]),
      },
    ]);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/documents/files',
      headers: body.headers,
      payload: body.payload,
    });

    expect(response.statusCode).toBe(202);
    expect(response.json().items[0]).toMatchObject({
      fileName: 'notes.md',
      status: 'failed',
      errorCode: 'UNSUPPORTED_FORMAT',
    });
    expect(deps.documents.ingestFile).not.toHaveBeenCalled();
    await app.close();
  });

  it('returns duplicate when the service detects the same file', async () => {
    const deps = fakeDeps();
    vi.mocked(deps.documents.ingestFile).mockResolvedValue({
      status: 'duplicate',
      documentId: 'doc-1',
    });
    const app = buildApp(deps);
    const body = multipart([
      { name: 'notes.md', type: 'text/markdown', buffer: Buffer.from('# Hello\n') },
    ]);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/documents/files',
      headers: body.headers,
      payload: body.payload,
    });

    expect(response.statusCode).toBe(202);
    expect(response.json().items[0]).toEqual({
      fileName: 'notes.md',
      status: 'duplicate',
      documentId: 'doc-1',
    });
    await app.close();
  });

  it('rejects a batch larger than 200 files', async () => {
    const deps = fakeDeps();
    vi.mocked(deps.documents.ingestFile).mockResolvedValue({
      status: 'queued',
      documentId: 'doc-1',
      versionId: 'ver-1',
      jobId: 'job-1',
    });
    const app = buildApp(deps);
    const files = Array.from({ length: 201 }, (_, index) => ({
      name: `file-${index}.md`,
      type: 'text/markdown',
      buffer: Buffer.from('x'),
    }));
    const body = multipart(files);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/documents/files',
      headers: body.headers,
      payload: body.payload,
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('BATCH_TOO_LARGE');
    await app.close();
  });
});

describe('POST /api/v1/documents/text', () => {
  it('ingests manual text and returns a queued item', async () => {
    const deps = fakeDeps();
    vi.mocked(deps.documents.ingestText).mockResolvedValue({
      status: 'queued',
      documentId: 'doc-1',
      versionId: 'ver-1',
      jobId: 'job-1',
    });
    const app = buildApp(deps);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/documents/text',
      payload: {
        title: 'My note',
        content: 'hello world',
        tags: ['manual'],
      },
    });

    expect(response.statusCode).toBe(202);
    expect(response.json()).toEqual({
      item: {
        status: 'queued',
        documentId: 'doc-1',
        versionId: 'ver-1',
        jobId: 'job-1',
      },
    });
    expect(deps.documents.ingestText).toHaveBeenCalledWith({
      title: 'My note',
      content: 'hello world',
      tags: ['manual'],
    });
    await app.close();
  });

  it('rejects content over 200000 characters', async () => {
    const deps = fakeDeps();
    const app = buildApp(deps);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/documents/text',
      payload: {
        title: 'Too long',
        content: 'x'.repeat(200_001),
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('TEXT_TOO_LONG');
    expect(deps.documents.ingestText).not.toHaveBeenCalled();
    await app.close();
  });

  it('rejects a missing title', async () => {
    const deps = fakeDeps();
    const app = buildApp(deps);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/documents/text',
      payload: { content: 'hello' },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('INVALID_ARGUMENT');
    expect(deps.documents.ingestText).not.toHaveBeenCalled();
    await app.close();
  });
});

describe('POST /api/v1/documents/urls', () => {
  it('fetches and ingests a URL', async () => {
    const deps = fakeDeps();
    vi.mocked(deps.urlFetcher.fetch).mockResolvedValue({
      finalUrl: 'https://example.com/',
      mimeType: 'text/html',
      buffer: Buffer.from('<html><body>hello</body></html>'),
    });
    vi.mocked(deps.documents.ingestUrl).mockResolvedValue({
      status: 'queued',
      documentId: 'doc-1',
      versionId: 'ver-1',
      jobId: 'job-1',
    });
    const app = buildApp(deps);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/documents/urls',
      payload: { urls: ['https://example.com'] },
    });

    expect(response.statusCode).toBe(202);
    expect(response.json()).toEqual({
      items: [
        {
          fileName: 'https://example.com',
          status: 'queued',
          documentId: 'doc-1',
          versionId: 'ver-1',
          jobId: 'job-1',
        },
      ],
    });
    expect(deps.documents.ingestUrl).toHaveBeenCalledWith({
      url: 'https://example.com',
      finalUrl: 'https://example.com/',
      mimeType: 'text/html',
      buffer: expect.any(Buffer),
    });
    await app.close();
  });

  it('marks an SSRF-blocked URL as failed', async () => {
    const deps = fakeDeps();
    vi.mocked(deps.urlFetcher.fetch).mockRejectedValue(new ApiError('SSRF_BLOCKED'));
    const app = buildApp(deps);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/documents/urls',
      payload: { urls: ['http://127.0.0.1'] },
    });

    expect(response.statusCode).toBe(202);
    expect(response.json().items[0]).toMatchObject({
      fileName: 'http://127.0.0.1',
      status: 'failed',
      errorCode: 'SSRF_BLOCKED',
    });
    expect(deps.documents.ingestUrl).not.toHaveBeenCalled();
    await app.close();
  });

  it('rejects more than 20 URLs', async () => {
    const app = buildApp(fakeDeps());

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/documents/urls',
      payload: {
        urls: Array.from({ length: 21 }, (_, index) => `https://example.com/${index}`),
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('BATCH_TOO_LARGE');
    await app.close();
  });

  it('rejects an invalid URL', async () => {
    const app = buildApp(fakeDeps());

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/documents/urls',
      payload: { urls: ['not-a-url'] },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('INVALID_ARGUMENT');
    await app.close();
  });
});
