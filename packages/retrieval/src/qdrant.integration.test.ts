import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { QdrantStore } from './qdrant.js';

const collection = `kos_test_${randomUUID().replaceAll('-', '')}`;
const store = new QdrantStore({
  url: process.env.QDRANT_URL ?? 'http://127.0.0.1:6333',
  collection,
  vectorSize: 8,
});

describe.skipIf(!process.env.QDRANT_URL)('QdrantStore', () => {
  beforeAll(async () => {
    await store.ensureCollection();
    await store.createPayloadIndexes();
  });

  afterAll(async () => {
    await store.deleteCollection();
  });

  it('upserts, filters, and deletes points by version', async () => {
    const documentId = randomUUID();
    const versionId = randomUUID();

    await store.upsert([
      {
        id: randomUUID(),
        vector: [1, 0, 0, 0, 0, 0, 0, 0],
        payload: {
          chunkId: 'c1',
          documentId,
          versionId,
          isCurrent: true,
          tags: ['rag'],
          type: 'text',
          createdAt: Date.now(),
        },
      },
      {
        id: randomUUID(),
        vector: [0, 1, 0, 0, 0, 0, 0, 0],
        payload: {
          chunkId: 'c2',
          documentId: randomUUID(),
          versionId,
          isCurrent: true,
          tags: ['other'],
          type: 'text',
          createdAt: Date.now(),
        },
      },
    ]);

    await store.waitForPoints(2);

    const results = await store.search([1, 0, 0, 0, 0, 0, 0, 0], {
      limit: 5,
      filter: { documentIds: [documentId], isCurrent: true },
    });

    expect(results).toHaveLength(1);
    expect(results[0]?.payload?.chunkId).toBe('c1');

    await store.deleteByVersion(versionId);

    const after = await store.search([1, 0, 0, 0, 0, 0, 0, 0], {
      limit: 5,
      filter: { versionIds: [versionId] },
    });

    expect(after).toHaveLength(0);
  });
});
