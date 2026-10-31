import { chunkDocument, type ChunkOptions } from '@kos/chunking';
import type {
  ChunkRepository,
  DocumentRepository,
  JobRepository,
  Prisma,
  PrismaClient,
} from '@kos/database';
import { normalizeVector, type EmbeddingProvider } from '@kos/embeddings';
import {
  countWords,
  parseDocument,
  type ParsedBlock,
  type ParsedDocument,
  type ParsedPage,
} from '@kos/parser';
import type { QdrantStore } from '@kos/retrieval';
import { ApiError, normalizeText } from '@kos/shared';
import type { StorageAdapter } from '@kos/storage';

type PipelineJob = NonNullable<Awaited<ReturnType<JobRepository['getById']>>>;
type StepName = PipelineJob['steps'][number]['step'];

export interface PipelineDeps {
  prisma: PrismaClient;
  documents: DocumentRepository;
  chunks: ChunkRepository;
  jobs: JobRepository;
  storage: StorageAdapter;
  embeddings: EmbeddingProvider;
  qdrant: QdrantStore;
}

interface VersionMetadata {
  title?: string;
  language?: string;
  author?: string;
  wordCount?: number;
  parsedBlocks?: ParsedBlock[];
  pages?: ParsedPage[];
  [key: string]: unknown;
}

const STEP_ATTEMPTS = 3;
const RETRY_DELAYS = [1000, 4000];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function loadChunkOptions(prisma: PrismaClient): Promise<Partial<ChunkOptions>> {
  const rows = await prisma.appSetting.findMany({
    where: { key: { in: ['chunking.targetMin', 'chunking.targetMax', 'chunking.hardMax'] } },
  });
  const values = new Map(rows.map((row) => [row.key, row.value]));

  const read = (key: string, fallback: number): number => {
    const value = values.get(key);
    return typeof value === 'number' ? value : fallback;
  };

  return {
    targetMin: read('chunking.targetMin', 300),
    targetMax: read('chunking.targetMax', 800),
    hardMax: read('chunking.hardMax', 1200),
  };
}

async function stepParse(deps: PipelineDeps, job: PipelineJob): Promise<Prisma.InputJsonValue> {
  const version = await deps.documents.getVersionById(job.versionId);
  if (!version) {
    throw new ApiError('NOT_FOUND', '版本不存在');
  }

  const metadata = (version.metadata ?? {}) as VersionMetadata;
  if (Array.isArray(metadata.parsedBlocks) && typeof version.normalizedText === 'string') {
    return { reused: true, charCount: version.normalizedText.length };
  }
  if (!version.storageKey) {
    throw new ApiError('UNSUPPORTED_FORMAT', '缺少原始文件');
  }

  const bytes = await deps.storage.get(version.storageKey);
  const parsed = await parseDocument(version.mimeType ?? 'text/plain', bytes);

  if (parsed.warnings.includes('needs_ocr')) {
    throw new ApiError('NEEDS_OCR');
  }

  await deps.documents.updateVersionContent(version.id, {
    normalizedText: parsed.text,
    charCount: parsed.text.length,
    ...(parsed.pages.length > 0 ? { pageCount: parsed.pages.length } : {}),
    ...(parsed.metadata.language ? { language: parsed.metadata.language } : {}),
    metadata: {
      ...parsed.metadata,
      parsedBlocks: parsed.blocks,
      pages: parsed.pages,
    } as unknown as Prisma.InputJsonValue,
  });

  return {
    reused: false,
    charCount: parsed.text.length,
    pageCount: parsed.pages.length,
  };
}

async function stepClean(deps: PipelineDeps, job: PipelineJob): Promise<Prisma.InputJsonValue> {
  const version = await deps.documents.getVersionById(job.versionId);
  if (!version) {
    throw new ApiError('NOT_FOUND', '版本不存在');
  }

  const text = version.normalizedText ?? '';
  const cleaned = normalizeText(text);
  if (cleaned.length === 0) {
    throw new ApiError('UNSUPPORTED_FORMAT', '正文为空');
  }

  if (cleaned !== text) {
    await deps.documents.updateVersionContent(version.id, {
      normalizedText: cleaned,
      charCount: cleaned.length,
    });
  }

  return { charCount: cleaned.length, changed: cleaned !== text };
}

async function stepMetadata(deps: PipelineDeps, job: PipelineJob): Promise<Prisma.InputJsonValue> {
  const version = await deps.documents.getVersionById(job.versionId);
  if (!version) {
    throw new ApiError('NOT_FOUND', '版本不存在');
  }

  const metadata = (version.metadata ?? {}) as VersionMetadata;
  const title = metadata.title?.trim() || version.document.title;
  const language = metadata.language ?? version.language ?? undefined;
  const wordCount = countWords(version.normalizedText ?? '');

  await deps.documents.updateVersionContent(version.id, {
    metadata: { ...metadata, title, wordCount } as unknown as Prisma.InputJsonValue,
    ...(language ? { language } : {}),
  });

  return { title, wordCount, ...(language ? { language } : {}) };
}

async function stepDedupe(deps: PipelineDeps, job: PipelineJob): Promise<Prisma.InputJsonValue> {
  const version = await deps.documents.getVersionById(job.versionId);
  if (!version) {
    throw new ApiError('NOT_FOUND', '版本不存在');
  }

  const otherDocuments = await deps.prisma.documentVersion.count({
    where: {
      contentHash: version.contentHash,
      documentId: { not: version.documentId },
    },
  });

  return { contentHash: version.contentHash, otherDocuments };
}

async function stepChunk(deps: PipelineDeps, job: PipelineJob): Promise<Prisma.InputJsonValue> {
  const version = await deps.documents.getVersionById(job.versionId);
  if (!version) {
    throw new ApiError('NOT_FOUND', '版本不存在');
  }

  const metadata = (version.metadata ?? {}) as VersionMetadata;
  const parsed: ParsedDocument = {
    text: version.normalizedText ?? '',
    pages: Array.isArray(metadata.pages) ? metadata.pages : [],
    blocks: Array.isArray(metadata.parsedBlocks) ? metadata.parsedBlocks : [],
    metadata: {
      wordCount: metadata.wordCount ?? 0,
      ...(metadata.title ? { title: metadata.title } : {}),
      ...(metadata.language ? { language: metadata.language } : {}),
    },
    warnings: [],
  };

  const drafts = chunkDocument(parsed, await loadChunkOptions(deps.prisma));
  if (drafts.length === 0) {
    throw new ApiError('UNSUPPORTED_FORMAT', '正文过短，无法切块');
  }

  await deps.chunks.replaceForVersion(
    version.documentId,
    version.id,
    drafts.map((draft) => ({
      chunkIndex: draft.index,
      text: draft.text,
      tokenCount: draft.tokenCount,
      startOffset: draft.startOffset,
      endOffset: draft.endOffset,
      ...(draft.pageStart === undefined ? {} : { pageStart: draft.pageStart }),
      ...(draft.pageEnd === undefined ? {} : { pageEnd: draft.pageEnd }),
      headingPath: draft.headingPath,
      type: draft.type,
      ...(draft.location ? { location: draft.location as unknown as Prisma.InputJsonValue } : {}),
      searchText: draft.searchText,
    })),
  );

  return { chunkCount: drafts.length };
}

async function stepEmbed(deps: PipelineDeps, job: PipelineJob): Promise<Prisma.InputJsonValue> {
  const version = await deps.documents.getVersionById(job.versionId);
  if (!version) {
    throw new ApiError('NOT_FOUND', '版本不存在');
  }

  const chunks = await deps.chunks.listByVersion(version.id);
  if (chunks.length === 0) {
    throw new ApiError('INTERNAL', '没有可向量化的块');
  }

  const pending = chunks.filter((chunk) => chunk.vectorStatus !== 'ready');
  if (pending.length === 0) {
    return { reused: true, chunkCount: chunks.length };
  }

  await deps.qdrant.ensureCollection();
  await deps.qdrant.createPayloadIndexes();

  const vectors = await deps.embeddings.embed(pending.map((chunk) => chunk.text));
  if (vectors.length !== pending.length) {
    throw new ApiError('PROVIDER_UNAVAILABLE', 'embedding 数量与块数量不一致');
  }

  const createdAt = Date.now();
  await deps.qdrant.upsert(
    pending.map((chunk, index) => ({
      id: chunk.id,
      vector: normalizeVector(vectors[index]!),
      payload: {
        chunkId: chunk.id,
        documentId: version.documentId,
        versionId: version.id,
        isCurrent: version.isCurrent,
        tags: version.document.tags,
        type: chunk.type,
        createdAt,
      },
    })),
  );

  await deps.chunks.markVectorReady(
    pending.map((chunk) => chunk.id),
    deps.embeddings.model,
    deps.embeddings.dim,
  );

  return { embedded: pending.length, model: deps.embeddings.model, dim: deps.embeddings.dim };
}

async function stepIndex(deps: PipelineDeps, job: PipelineJob): Promise<Prisma.InputJsonValue> {
  const version = await deps.documents.getVersionById(job.versionId);
  if (!version) {
    throw new ApiError('NOT_FOUND', '版本不存在');
  }

  const chunks = await deps.chunks.listByVersion(version.id);
  const missing = chunks.filter((chunk) => chunk.vectorStatus !== 'ready').length;
  if (missing > 0) {
    throw new ApiError('PROVIDER_UNAVAILABLE', `还有 ${missing} 个块未完成向量化`);
  }

  await deps.qdrant.setCurrentVersion(version.documentId, version.id);
  await deps.documents.updateVersionStatus(version.id, 'ready');

  return { chunkCount: chunks.length, ready: true };
}

const STEP_RUNNERS: Record<
  StepName,
  (deps: PipelineDeps, job: PipelineJob) => Promise<Prisma.InputJsonValue>
> = {
  parse: stepParse,
  clean: stepClean,
  metadata: stepMetadata,
  dedupe: stepDedupe,
  chunk: stepChunk,
  embed: stepEmbed,
  index: stepIndex,
};

async function failJob(
  deps: PipelineDeps,
  job: PipelineJob,
  step: StepName,
  error: unknown,
): Promise<void> {
  const apiError = error instanceof ApiError ? error : new ApiError('INTERNAL');
  const stack = error instanceof Error ? (error.stack ?? null) : null;

  await deps.jobs.updateStep(job.id, step, {
    status: 'failed',
    finishedAt: new Date(),
    errorCode: apiError.code,
    errorMessage: apiError.message,
    errorStack: stack,
  });
  await deps.jobs.updateJob(job.id, {
    status: 'failed',
    errorCode: apiError.code,
    errorMessage: apiError.message,
    errorStack: stack,
    finishedAt: new Date(),
  });
  await deps.documents.updateVersionStatus(
    job.versionId,
    apiError.code === 'NEEDS_OCR' ? 'needs_ocr' : 'failed',
  );
}

export async function runPipeline(deps: PipelineDeps, jobId: string): Promise<void> {
  const job = await deps.jobs.getById(jobId);
  if (!job) {
    throw new Error(`processing job ${jobId} not found`);
  }
  if (job.status === 'canceled') {
    return;
  }

  await deps.documents.updateVersionStatus(job.versionId, 'processing');
  await deps.jobs.updateJob(jobId, {
    status: 'running',
    startedAt: job.startedAt ?? new Date(),
    finishedAt: null,
    errorCode: null,
    errorMessage: null,
    errorStack: null,
  });

  for (const step of job.steps) {
    const current = await deps.jobs.getById(jobId);
    if (current?.status === 'canceled') {
      return;
    }
    if (step.status === 'succeeded') {
      continue;
    }

    await deps.jobs.updateJob(jobId, { currentStep: step.step });
    await deps.jobs.updateStep(jobId, step.step, {
      status: 'running',
      attempt: step.attempt + 1,
      startedAt: new Date(),
      errorCode: null,
      errorMessage: null,
      errorStack: null,
    });

    let lastError: unknown;
    let succeeded = false;

    for (let attempt = 0; attempt < STEP_ATTEMPTS; attempt += 1) {
      try {
        const summary = await STEP_RUNNERS[step.step](deps, job);
        await deps.jobs.updateStep(jobId, step.step, {
          status: 'succeeded',
          finishedAt: new Date(),
          outputSummary: summary,
        });
        succeeded = true;
        break;
      } catch (error) {
        lastError = error;
        const retryable = !(error instanceof ApiError) || error.retryable;
        if (!retryable || attempt === STEP_ATTEMPTS - 1) {
          break;
        }
        await sleep(RETRY_DELAYS[attempt] ?? 4000);
      }
    }

    if (!succeeded) {
      await failJob(deps, job, step.step, lastError);
      return;
    }
  }

  await deps.jobs.updateJob(jobId, {
    status: 'succeeded',
    currentStep: null,
    finishedAt: new Date(),
  });
}
