import { basename, extname } from 'node:path';
import type { DocumentRepository } from '@kos/database';
import { contentHash, fileHash, normalizeUrl } from '@kos/shared';
import { buildObjectKey, type StorageAdapter } from '@kos/storage';

export interface IngestFileInput {
  fileName: string;
  buffer: Buffer;
  mimeType: string;
  tags: string[];
}

export interface IngestTextInput {
  title: string;
  content: string;
  tags: string[];
}

export interface IngestUrlInput {
  url: string;
  finalUrl: string;
  buffer: Buffer;
  mimeType: string;
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

  async ingestText(input: IngestTextInput): Promise<IngestFileResult> {
    const hash = contentHash(input.content);
    const fingerprint = input.title.trim().toLowerCase();
    const source = {
      type: 'manual' as const,
      fingerprint,
      identifier: input.title,
    };

    const existing = await this.documents.findVersionByContentHash(hash);
    if (existing) {
      await this.documents.attachSource(existing.documentId, source);
      return {
        status: 'duplicate',
        documentId: existing.documentId,
        versionId: existing.versionId,
      };
    }

    const storageKey = buildObjectKey(hash);
    const content = Buffer.from(input.content, 'utf8');
    await this.storage.put(storageKey, content, 'text/markdown');

    const existingDocument = await this.documents.findDocumentBySource('manual', fingerprint);
    if (existingDocument) {
      const appended = await this.documents.appendVersion(existingDocument.documentId, {
        contentHash: hash,
        storageKey,
        storageSize: content.length,
        mimeType: 'text/markdown',
        originalFilename: `${input.title}.md`,
        sourceId: existingDocument.sourceId,
      });

      return {
        status: 'queued',
        documentId: existingDocument.documentId,
        versionId: appended.versionId,
        jobId: appended.jobId,
      };
    }

    const created = await this.documents.createWithVersion({
      title: input.title,
      tags: input.tags,
      source,
      version: {
        contentHash: hash,
        storageKey,
        storageSize: content.length,
        mimeType: 'text/markdown',
        originalFilename: `${input.title}.md`,
      },
    });

    return { status: 'queued', ...created };
  }

  async ingestUrl(input: IngestUrlInput): Promise<IngestFileResult> {
    const hash = fileHash(input.buffer);
    const fingerprint = normalizeUrl(input.url);
    const source = {
      type: 'url' as const,
      fingerprint,
      identifier: input.url,
      metadata: { finalUrl: input.finalUrl },
    };

    const existing = await this.documents.findVersionByFileHash(hash);
    if (existing) {
      await this.documents.attachSource(existing.documentId, source);
      return {
        status: 'duplicate',
        documentId: existing.documentId,
        versionId: existing.versionId,
      };
    }

    const storageKey = buildObjectKey(hash);
    await this.storage.put(storageKey, input.buffer, input.mimeType);

    const title = new URL(input.url).hostname;
    const existingDocument = await this.documents.findDocumentBySource('url', fingerprint);
    if (existingDocument) {
      const appended = await this.documents.appendVersion(existingDocument.documentId, {
        contentHash: hash,
        fileHash: hash,
        storageKey,
        storageSize: input.buffer.length,
        mimeType: input.mimeType,
        originalFilename: input.url,
        sourceId: existingDocument.sourceId,
      });

      return {
        status: 'queued',
        documentId: existingDocument.documentId,
        versionId: appended.versionId,
        jobId: appended.jobId,
      };
    }

    const created = await this.documents.createWithVersion({
      title,
      tags: [],
      source,
      version: {
        contentHash: hash,
        fileHash: hash,
        storageKey,
        storageSize: input.buffer.length,
        mimeType: input.mimeType,
        originalFilename: input.url,
      },
    });

    return { status: 'queued', ...created };
  }
}
