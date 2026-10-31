import { describe, expect, it } from 'vitest';
import type { Env } from '@kos/shared';
import { collectionName, createEmbeddingProvider } from './config.js';

function env(overrides: Partial<Env>): Env {
  return {
    NODE_ENV: 'test',
    HOST: '127.0.0.1',
    PORT: 3000,
    WEB_ORIGIN: 'http://localhost:5173',
    DATABASE_URL: 'postgresql://user:pass@localhost:5432/knowledgeos',
    REDIS_URL: 'redis://localhost:6379',
    QDRANT_URL: 'http://localhost:6333',
    DATA_DIR: './data',
    EMBEDDING_MODEL: 'text-embedding-3-small',
    EMBEDDING_DIM: 1536,
    LOG_LEVEL: 'fatal',
    ...overrides,
  };
}

describe('createEmbeddingProvider', () => {
  it('未配置密钥时回退到 Fake', () => {
    const provider = createEmbeddingProvider(env({}));

    expect(provider.model).toBe('fake-embedding');
    expect(provider.dim).toBe(1536);
  });

  it('配置密钥时使用 OpenAI 兼容实现', () => {
    const provider = createEmbeddingProvider(
      env({ EMBEDDING_API_KEY: 'test-key', EMBEDDING_MODEL: 'bge-m3', EMBEDDING_DIM: 1024 }),
    );

    expect(provider.model).toBe('bge-m3');
    expect(provider.dim).toBe(1024);
  });

  it('生产环境缺少密钥时拒绝启动', () => {
    expect(() => createEmbeddingProvider(env({ NODE_ENV: 'production' }))).toThrow(
      /EMBEDDING_API_KEY/,
    );
  });
});

describe('collectionName', () => {
  it('模型名转成安全集合名', () => {
    expect(collectionName('text-embedding-3-small', 1536)).toBe(
      'kos_chunks_text_embedding_3_small_1536',
    );
  });
});
