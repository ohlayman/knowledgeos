import { QdrantClient, type Schemas } from '@qdrant/js-client-rest';

export interface QdrantConfig {
  url: string;
  apiKey?: string;
  collection: string;
  vectorSize: number;
}

export interface ChunkPayload {
  chunkId: string;
  documentId: string;
  versionId: string;
  isCurrent: boolean;
  tags: string[];
  type: string;
  createdAt: number;
}

export interface ChunkPoint {
  id: string;
  vector: number[];
  payload: ChunkPayload;
}

export interface VectorFilter {
  documentIds?: string[];
  versionIds?: string[];
  tags?: string[];
  isCurrent?: boolean;
  chunkTypes?: string[];
}

export interface VectorSearchOptions {
  limit?: number;
  filter?: VectorFilter;
  scoreThreshold?: number;
}

export interface VectorSearchResult {
  id: string;
  score: number;
  payload: ChunkPayload | null;
}

const PAYLOAD_INDEXES: Array<{
  field_name: string;
  field_schema: 'keyword' | 'bool' | 'integer';
}> = [
  { field_name: 'chunkId', field_schema: 'keyword' },
  { field_name: 'documentId', field_schema: 'keyword' },
  { field_name: 'versionId', field_schema: 'keyword' },
  { field_name: 'isCurrent', field_schema: 'bool' },
  { field_name: 'tags', field_schema: 'keyword' },
  { field_name: 'type', field_schema: 'keyword' },
  { field_name: 'createdAt', field_schema: 'integer' },
];

export class QdrantStore {
  private readonly client: QdrantClient;

  constructor(private readonly config: QdrantConfig) {
    this.client = new QdrantClient({
      url: config.url,
      apiKey: config.apiKey,
    });
  }

  async ensureCollection(): Promise<void> {
    const { collections } = await this.client.getCollections();
    if (collections.some((collection) => collection.name === this.config.collection)) {
      return;
    }

    await this.client.createCollection(this.config.collection, {
      vectors: {
        size: this.config.vectorSize,
        distance: 'Cosine',
      },
      hnsw_config: {
        m: 16,
        ef_construct: 100,
      },
    });
  }

  async createPayloadIndexes(): Promise<void> {
    const info = await this.client.getCollection(this.config.collection);
    const existing = new Set(Object.keys(info.payload_schema ?? {}));

    for (const index of PAYLOAD_INDEXES) {
      if (existing.has(index.field_name)) {
        continue;
      }
      await this.client.createPayloadIndex(this.config.collection, {
        ...index,
        wait: true,
      });
    }
  }

  async upsert(points: ChunkPoint[]): Promise<void> {
    if (points.length === 0) {
      return;
    }

    await this.client.upsert(this.config.collection, {
      wait: true,
      points: points.map((point) => ({
        id: point.id,
        vector: point.vector,
        payload: point.payload as unknown as Record<string, unknown>,
      })),
    });
  }

  async setCurrentVersion(documentId: string, versionId: string): Promise<void> {
    await this.client.setPayload(this.config.collection, {
      payload: { isCurrent: false },
      filter: { must: [{ key: 'documentId', match: { value: documentId } }] },
      wait: true,
    });
    await this.client.setPayload(this.config.collection, {
      payload: { isCurrent: true },
      filter: { must: [{ key: 'versionId', match: { value: versionId } }] },
      wait: true,
    });
  }

  async search(vector: number[], options: VectorSearchOptions = {}): Promise<VectorSearchResult[]> {
    const response = await this.client.query(this.config.collection, {
      query: vector,
      limit: options.limit ?? 10,
      filter: this.buildFilter(options.filter),
      with_payload: true,
      ...(options.scoreThreshold === undefined ? {} : { score_threshold: options.scoreThreshold }),
    });

    return response.points.map((point) => ({
      id: String(point.id),
      score: point.score,
      payload: (point.payload as ChunkPayload | null | undefined) ?? null,
    }));
  }

  async waitForPoints(expected: number, timeoutMs = 120_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;

    for (;;) {
      const info = await this.client.getCollection(this.config.collection);
      const points = info.points_count ?? 0;

      if (points >= expected && info.status === 'green') {
        return;
      }

      if (Date.now() >= deadline) {
        throw new Error(
          `Timed out waiting for ${expected} points (points=${points}, status=${info.status})`,
        );
      }

      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }

  async deleteByVersion(versionId: string): Promise<void> {
    await this.client.delete(this.config.collection, {
      wait: true,
      filter: {
        must: [{ key: 'versionId', match: { value: versionId } }],
      },
    });
  }

  async scrollIds(pageSize = 1000): Promise<string[]> {
    const ids: string[] = [];
    let offset: string | number | undefined;

    for (;;) {
      const response = await this.client.scroll(this.config.collection, {
        limit: pageSize,
        with_payload: false,
        with_vector: false,
        ...(offset === undefined ? {} : { offset }),
      });

      for (const point of response.points) {
        ids.push(String(point.id));
      }

      const next = response.next_page_offset;
      if (next === null || next === undefined) {
        break;
      }
      offset = typeof next === 'object' ? String(next) : next;
    }

    return ids;
  }

  async deleteByIds(ids: string[]): Promise<void> {
    if (ids.length === 0) {
      return;
    }
    await this.client.delete(this.config.collection, { wait: true, points: ids });
  }

  async deleteCollection(): Promise<void> {
    await this.client.deleteCollection(this.config.collection);
  }

  async listCollections(): Promise<string[]> {
    const { collections } = await this.client.getCollections();
    return collections.map((collection) => collection.name);
  }

  async updateAlias(alias: string): Promise<void> {
    await this.client.updateCollectionAliases({
      actions: [
        {
          create_alias: {
            collection_name: this.config.collection,
            alias_name: alias,
          },
        },
      ],
    });
  }

  private buildFilter(filter?: VectorFilter): Schemas['Filter'] | undefined {
    if (!filter) {
      return undefined;
    }

    const must: Schemas['Condition'][] = [];

    if (filter.isCurrent !== undefined) {
      must.push({ key: 'isCurrent', match: { value: filter.isCurrent } });
    }
    if (filter.documentIds?.length) {
      must.push({ key: 'documentId', match: { any: filter.documentIds } });
    }
    if (filter.versionIds?.length) {
      must.push({ key: 'versionId', match: { any: filter.versionIds } });
    }
    if (filter.tags?.length) {
      must.push({ key: 'tags', match: { any: filter.tags } });
    }
    if (filter.chunkTypes?.length) {
      must.push({ key: 'type', match: { any: filter.chunkTypes } });
    }

    return must.length > 0 ? { must } : undefined;
  }
}
