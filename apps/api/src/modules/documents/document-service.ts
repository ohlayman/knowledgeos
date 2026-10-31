import { basename, extname } from 'node:path';
import type { DocumentRepository } from '@kos/database';
import { fileHash } from '@kos/shared';
import { buildObjectKey, type StorageAdapter } from '@kos/storage';

export interface IngestFileInput {
  fileName: string;
  buffer: Buffer;
  mimeType: string;
  tags: string[];
}

export interface IngestFileResult {
  status: 'queued' | 'duplicate';
  documentId: string;
  versionId?: string;
  jobId?: string;
}

export class DocumentService {
  constructor(
    private readonly documents: DocumentRepository,
    private readonly storage: StorageAdapter,
  ) {}

  async ingestFile(input: IngestFileInput): Promise<IngestFileResult> {
    const hash = fileHash(input.buffer);
    const existing = await this.documents.findVersionByFileHash(hash);
    if (existing) {
      return {
        status: 'duplicate',
        documentId: existing.documentId,
        versionId: existing.versionId,
      };
    }

    const storageKey = buildObjectKey(hash);
    await this.storage.put(storageKey, input.buffer, input.mimeType);

    const fingerprint = input.fileName.trim().toLowerCase();
    const source = await this.documents.findDocumentBySource('file', fingerprint);
    const title = basename(input.fileName, extname(input.fileName)) || input.fileName;

    if (source) {
      const appended = await this.documents.appendVersion(source.documentId, {
        // M2-T10 replaces this with the normalized-content hash after parsing.
        contentHash: hash,
        fileHash: hash,
        storageKey,
        storageSize: input.buffer.length,
        mimeType: input.mimeType,
        originalFilename: input.fileName,
        sourceId: source.sourceId,
      });

      return {
        status: 'queued',
        documentId: source.documentId,
        versionId: appended.versionId,
        jobId: appended.jobId,
      };
    }

    const created = await this.documents.createWithVersion({
      title,
      tags: input.tags,
      source: {
        type: 'file',
        fingerprint,
        identifier: input.fileName,
      },
      version: {
        contentHash: hash,
        fileHash: hash,
        storageKey,
        storageSize: input.buffer.length,
        mimeType: input.mimeType,
        originalFilename: input.fileName,
      },
    });

    return { status: 'queued', ...created };
  }
}
