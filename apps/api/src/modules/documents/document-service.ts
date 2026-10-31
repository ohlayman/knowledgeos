import { basename, extname } from 'node:path';
import type {
  DocumentListResult,
  DocumentRepository,
  SourceType,
  VersionStatus,
} from '@kos/database';
import { parseDocument, parsePlainText, type ParsedDocument } from '@kos/parser';
import { ApiError, contentHash, fileHash, normalizeUrl } from '@kos/shared';
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

interface SourceInput {
  type: 'file' | 'url' | 'manual';
  fingerprint: string;
  identifier: string;
  metadata?: { finalUrl: string };
}

interface VersionFiles {
  fileHash?: string;
  storageKey?: string;
  storageSize?: number;
  mimeType?: string;
  originalFilename?: string;
}

interface CommitInput {
  parsed: ParsedDocument;
  source: SourceInput;
  title: string;
  tags: string[];
  files: VersionFiles;
  persist: () => Promise<void>;
}

export class DocumentService {
  constructor(
    private readonly documents: DocumentRepository,
    private readonly storage: StorageAdapter,
  ) {}

  async ingestFile(input: IngestFileInput): Promise<IngestFileResult> {
    const rawHash = fileHash(input.buffer);
    const source: SourceInput = {
      type: 'file',
      fingerprint: input.fileName.trim().toLowerCase(),
      identifier: input.fileName,
    };

    const exactDuplicate = await this.documents.findVersionByFileHash(rawHash);
    if (exactDuplicate) {
      await this.documents.attachSource(exactDuplicate.documentId, source);
      return {
        status: 'duplicate',
        documentId: exactDuplicate.documentId,
        versionId: exactDuplicate.versionId,
      };
    }

    const parsed = await parseDocument(input.mimeType, input.buffer);
    const storageKey = buildObjectKey(rawHash);

    return this.commitParsed({
      parsed,
      source,
      title: basename(input.fileName, extname(input.fileName)) || input.fileName,
      tags: input.tags,
      files: {
        fileHash: rawHash,
        storageKey,
        storageSize: input.buffer.length,
        mimeType: input.mimeType,
        originalFilename: input.fileName,
      },
      persist: () => this.storage.put(storageKey, input.buffer, input.mimeType),
    });
  }

  async ingestText(input: IngestTextInput): Promise<IngestFileResult> {
    const content = Buffer.from(input.content, 'utf8');
    const storageKey = buildObjectKey(fileHash(content));

    return this.commitParsed({
      parsed: parsePlainText(input.content),
      source: {
        type: 'manual',
        fingerprint: input.title.trim().toLowerCase(),
        identifier: input.title,
      },
      title: input.title,
      tags: input.tags,
      files: {
        storageKey,
        storageSize: content.length,
        mimeType: 'text/plain',
        originalFilename: `${input.title}.txt`,
      },
      persist: () => this.storage.put(storageKey, content, 'text/plain'),
    });
  }

  async ingestUrl(input: IngestUrlInput): Promise<IngestFileResult> {
    const rawHash = fileHash(input.buffer);
    const source: SourceInput = {
      type: 'url',
      fingerprint: normalizeUrl(input.url),
      identifier: input.url,
      metadata: { finalUrl: input.finalUrl },
    };

    const exactDuplicate = await this.documents.findVersionByFileHash(rawHash);
    if (exactDuplicate) {
      await this.documents.attachSource(exactDuplicate.documentId, source);
      return {
        status: 'duplicate',
        documentId: exactDuplicate.documentId,
        versionId: exactDuplicate.versionId,
      };
    }

    const parsed = await parseDocument(input.mimeType, input.buffer);
    const storageKey = buildObjectKey(rawHash);

    return this.commitParsed({
      parsed,
      source,
      title: new URL(input.url).hostname,
      tags: [],
      files: {
        fileHash: rawHash,
        storageKey,
        storageSize: input.buffer.length,
        mimeType: input.mimeType,
        originalFilename: input.url,
      },
      persist: () => this.storage.put(storageKey, input.buffer, input.mimeType),
    });
  }

  async listDocuments(params: {
    status?: VersionStatus;
    type?: SourceType;
    tag?: string;
    q?: string;
    cursor?: string;
    limit?: number;
  }): Promise<DocumentListResult> {
    return this.documents.list({
      ...(params.status ? { status: params.status } : {}),
      ...(params.type ? { type: params.type } : {}),
      ...(params.tag ? { tags: [params.tag] } : {}),
      ...(params.q ? { q: params.q } : {}),
      ...(params.cursor ? { cursor: params.cursor } : {}),
      ...(params.limit ? { limit: params.limit } : {}),
    });
  }

  async getDocument(id: string) {
    const document = await this.documents.getById(id);
    if (!document || document.isDeleted) {
      throw new ApiError('NOT_FOUND', '文档不存在');
    }

    const versions = await this.documents.listVersions(id);
    return { ...document, versions };
  }

  async updateDocument(id: string, input: { title?: string; tags?: string[] }) {
    await this.requireDocument(id);
    await this.documents.update(id, input);
    return this.getDocument(id);
  }

  async deleteDocument(id: string): Promise<void> {
    await this.requireDocument(id);
    await this.documents.softDelete(id);
  }

  private async requireDocument(id: string) {
    const document = await this.documents.getById(id);
    if (!document || document.isDeleted) {
      throw new ApiError('NOT_FOUND', '文档不存在');
    }
    return document;
  }

  private async commitParsed(input: CommitInput): Promise<IngestFileResult> {
    const hash = contentHash(input.parsed.text);

    const sameContent = await this.documents.findVersionByContentHash(hash);
    if (sameContent) {
      await this.documents.attachSource(sameContent.documentId, input.source);
      return {
        status: 'duplicate',
        documentId: sameContent.documentId,
        versionId: sameContent.versionId,
      };
    }

    await input.persist();

    const version = {
      contentHash: hash,
      normalizedText: input.parsed.text,
      charCount: input.parsed.text.length,
      metadata: { ...input.parsed.metadata },
      ...(input.parsed.pages.length > 0 ? { pageCount: input.parsed.pages.length } : {}),
      ...(input.parsed.metadata.language ? { language: input.parsed.metadata.language } : {}),
      ...(input.parsed.warnings.length > 0 ? { parseWarnings: input.parsed.warnings } : {}),
      ...input.files,
    };

    const existingDocument = await this.documents.findDocumentBySource(
      input.source.type,
      input.source.fingerprint,
    );
    if (existingDocument) {
      const appended = await this.documents.appendVersion(existingDocument.documentId, {
        ...version,
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
      source: input.source,
      version,
    });

    return { status: 'queued', ...created };
  }
}
