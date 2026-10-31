import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { QdrantStore, type ChunkPoint } from '@kos/retrieval';

const { values } = parseArgs({
  options: {
    points: { type: 'string', default: '100000' },
    dim: { type: 'string', default: '1536' },
    queries: { type: 'string', default: '200' },
    batch: { type: 'string', default: '1000' },
  },
});

const pointCount = Number(values.points);
const dimensions = Number(values.dim);
const queryCount = Number(values.queries);
const batchSize = Number(values.batch);

if (![pointCount, dimensions, queryCount, batchSize].every((value) => value > 0)) {
  throw new Error('points, dim, queries and batch must be positive numbers');
}

const collection = `kos_bench_${Date.now()}`;
const store = new QdrantStore({
  url: process.env.QDRANT_URL ?? 'http://127.0.0.1:6333',
  collection,
  vectorSize: dimensions,
});

function randomUnitVector(size: number): number[] {
  const vector: number[] = new Array(size);
  let norm = 0;

  for (let i = 0; i < size; i += 1) {
    const value = Math.random() * 2 - 1;
    vector[i] = value;
    norm += value * value;
  }

  const inverseNorm = 1 / Math.sqrt(norm);
  for (let i = 0; i < size; i += 1) {
    vector[i] = vector[i]! * inverseNorm;
  }

  return vector;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) {
    return 0;
  }
  const index = Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1);
  return sorted[index] ?? 0;
}

async function main(): Promise<void> {
  const startedAt = performance.now();

  await store.ensureCollection();
  await store.createPayloadIndexes();

  for (let offset = 0; offset < pointCount; offset += batchSize) {
    const size = Math.min(batchSize, pointCount - offset);
    const points: ChunkPoint[] = [];

    for (let i = 0; i < size; i += 1) {
      const id = offset + i;
      points.push({
        id: randomUUID(),
        vector: randomUnitVector(dimensions),
        payload: {
          chunkId: `c-${id}`,
          documentId: `doc-${id % 5000}`,
          versionId: `ver-${id % 500}`,
          isCurrent: true,
          tags: [`tag-${id % 20}`],
          type: 'text',
          createdAt: Date.now(),
        },
      });
    }

    await store.upsert(points);
    if (offset % (batchSize * 10) === 0) {
      console.log(`upserted ${offset + size}/${pointCount}`);
    }
  }

  await store.waitForPoints(pointCount, 300_000);

  const filter = {
    isCurrent: true,
    documentIds: ['doc-1', 'doc-2'],
    tags: ['tag-1', 'tag-2'],
  };

  for (let i = 0; i < 10; i += 1) {
    await store.search(randomUnitVector(dimensions), { limit: 20, filter });
  }

  const latencies: number[] = [];
  for (let i = 0; i < queryCount; i += 1) {
    const started = performance.now();
    await store.search(randomUnitVector(dimensions), { limit: 20, filter });
    latencies.push(performance.now() - started);
  }

  latencies.sort((a, b) => a - b);
  const report = {
    collection,
    points: pointCount,
    dimensions,
    queries: queryCount,
    p50Ms: percentile(latencies, 0.5),
    p95Ms: percentile(latencies, 0.95),
    p99Ms: percentile(latencies, 0.99),
    gateMs: 300,
    passed: percentile(latencies, 0.95) <= 300,
    upsertAndQueryMs: performance.now() - startedAt,
  };

  console.log(report);

  const reportPath = resolve(
    fileURLToPath(new URL('../reports/qdrant-bench.json', import.meta.url)),
  );
  await mkdir(dirname(reportPath), { recursive: true });
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

  await store.deleteCollection();
}

main().catch(async (error) => {
  console.error(error);
  try {
    await store.deleteCollection();
  } catch {
    // The collection may not exist if setup failed.
  }
  process.exit(1);
});
