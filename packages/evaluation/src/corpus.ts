import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { PrismaClient } from '@kos/database';
import { ChunkRepository, DocumentRepository } from '@kos/database';
import { normalizeVector, type EmbeddingProvider } from '@kos/embeddings';
import type { QdrantStore } from '@kos/retrieval';
import { buildSearchText, fileHash } from '@kos/shared';

export interface CorpusDocument {
  slug: string;
  title: string;
  chunks: string[];
}

export interface EvalDatasetItem {
  id: string;
  question: string;
  expectedSlug: string;
  type?: string;
}

export function loadCorpus(): CorpusDocument[] {
  const path = fileURLToPath(new URL('../fixtures/corpus.json', import.meta.url));
  return JSON.parse(readFileSync(path, 'utf8')) as CorpusDocument[];
}

export function loadDataset(): EvalDatasetItem[] {
  const path = fileURLToPath(new URL('../fixtures/retrieval.jsonl', import.meta.url));
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as EvalDatasetItem);
}

export interface SeedOptions {
  prisma: PrismaClient;
  embeddings: EmbeddingProvider;
  qdrant: QdrantStore;
  fingerprintPrefix: string;
}

export async function seedCorpus(
  corpus: CorpusDocument[],
  options: SeedOptions,
): Promise<Map<string, string>> {
  const documents = new DocumentRepository(options.prisma);
  const chunks = new ChunkRepository(options.prisma);
  const bySlug = new Map<string, string>();

  for (const document of corpus) {
    const fingerprint = `${options.fingerprintPrefix}/${document.slug}`;
    const existing = await documents.findDocumentBySource('file', fingerprint);
    if (existing) {
      bySlug.set(document.slug, existing.documentId);
      continue;
    }

    const text = document.chunks.join('\n\n');
    const created = await documents.createWithVersion({
      title: document.title,
      source: { type: 'file', fingerprint, identifier: fingerprint },
      version: {
        contentHash: fileHash(Buffer.from(`${fingerprint}:${text}`)),
        normalizedText: text,
        charCount: text.length,
      },
    });
    bySlug.set(document.slug, created.documentId);

    await chunks.replaceForVersion(
      created.documentId,
      created.versionId,
      document.chunks.map((chunk, index) => ({
        chunkIndex: index,
        text: chunk,
        tokenCount: chunk.length,
        startOffset: 0,
        endOffset: chunk.length,
        headingPath: [document.title],
        searchText: buildSearchText(chunk),
      })),
    );

    const rows = await chunks.listByVersion(created.versionId);
    const vectors = await options.embeddings.embed(rows.map((row) => row.text));
    await options.qdrant.upsert(
      rows.map((row, index) => ({
        id: row.id,
        vector: normalizeVector(vectors[index]!),
        payload: {
          chunkId: row.id,
          documentId: created.documentId,
          versionId: created.versionId,
          isCurrent: true,
          tags: [],
          type: 'text',
          createdAt: Date.now(),
        },
      })),
    );
    await chunks.markVectorReady(
      rows.map((row) => row.id),
      options.embeddings.model,
      options.embeddings.dim,
    );
    await documents.updateVersionStatus(created.versionId, 'ready');
  }

  return bySlug;
}
