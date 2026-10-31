import multipart from '@fastify/multipart';
import type { FastifyPluginAsync } from 'fastify';
import { ApiError, LIMITS, TextDocumentInputSchema, UrlImportInputSchema } from '@kos/shared';
import type { AppDeps } from '../../deps.js';
import { detectFileType } from './file-type.js';

interface UploadItem {
  fileName: string;
  status: 'queued' | 'duplicate' | 'failed';
  documentId?: string;
  versionId?: string;
  jobId?: string;
  errorCode?: string;
  message?: string;
}

export const documentRoutes: FastifyPluginAsync<{ deps: AppDeps }> = async (app, opts) => {
  await app.register(multipart, {
    limits: {
      fileSize: LIMITS.maxFileSizeBytes,
      files: LIMITS.maxBatchFiles,
      parts: LIMITS.maxBatchFiles + 10,
    },
  });

  app.post('/api/v1/documents/files', async (request, reply) => {
    const items: UploadItem[] = [];
    let tags: string[] = [];

    try {
      for await (const part of request.parts()) {
        if (part.type === 'field') {
          if (part.fieldname === 'tags') {
            tags = String(part.value)
              .split(',')
              .map((tag) => tag.trim())
              .filter((tag) => tag.length > 0)
              .slice(0, 20);
          }
          continue;
        }

        const fileName = part.filename || 'unnamed';
        const buffer = await part.toBuffer();

        try {
          const detected = await detectFileType(fileName, buffer);
          const result = await opts.deps.documents.ingestFile({
            fileName,
            buffer,
            mimeType: detected.mimeType,
            tags,
          });
          items.push({ fileName, ...result });
        } catch (error) {
          if (error instanceof ApiError) {
            items.push({
              fileName,
              status: 'failed',
              errorCode: error.code,
              message: error.message,
            });
            continue;
          }
          throw error;
        }
      }
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code === 'FST_FILES_LIMIT') {
        throw new ApiError('BATCH_TOO_LARGE');
      }
      if (code === 'FST_REQ_FILE_TOO_LARGE') {
        throw new ApiError('FILE_TOO_LARGE');
      }
      throw error;
    }

    if (items.length === 0) {
      throw new ApiError('INVALID_ARGUMENT', '没有收到文件');
    }

    return reply.status(202).send({ items });
  });

  app.post('/api/v1/documents/text', async (request, reply) => {
    const parsed = TextDocumentInputSchema.safeParse(request.body);
    if (!parsed.success) {
      const contentTooLong = parsed.error.issues.some(
        (issue) => issue.path[0] === 'content' && issue.code === 'too_big',
      );
      throw new ApiError(
        contentTooLong ? 'TEXT_TOO_LONG' : 'INVALID_ARGUMENT',
        contentTooLong ? undefined : '标题、正文或标签不合法',
      );
    }

    const result = await opts.deps.documents.ingestText({
      title: parsed.data.title,
      content: parsed.data.content,
      tags: parsed.data.tags,
    });

    return reply.status(202).send({ item: result });
  });

  app.post('/api/v1/documents/urls', async (request, reply) => {
    const parsed = UrlImportInputSchema.safeParse(request.body);
    if (!parsed.success) {
      const tooMany = parsed.error.issues.some(
        (issue) => issue.path[0] === 'urls' && issue.code === 'too_big',
      );
      throw new ApiError(
        tooMany ? 'BATCH_TOO_LARGE' : 'INVALID_ARGUMENT',
        tooMany ? undefined : 'URL 列表不合法',
      );
    }

    const urls = parsed.data.urls;
    const results: Array<UploadItem | undefined> = new Array(urls.length);
    let cursor = 0;

    const worker = async (): Promise<void> => {
      for (;;) {
        const index = cursor;
        cursor += 1;
        if (index >= urls.length) {
          return;
        }

        const url = urls[index]!;
        try {
          const fetched = await opts.deps.urlFetcher.fetch(url);
          const result = await opts.deps.documents.ingestUrl({
            url,
            ...fetched,
          });
          results[index] = { fileName: url, ...result };
        } catch (error) {
          if (error instanceof ApiError) {
            results[index] = {
              fileName: url,
              status: 'failed',
              errorCode: error.code,
              message: error.message,
            };
            continue;
          }
          throw error;
        }
      }
    };

    await Promise.all(Array.from({ length: Math.min(3, urls.length) }, () => worker()));

    return reply.status(202).send({
      items: results.filter((item): item is UploadItem => item !== undefined),
    });
  });
};
