import { describe, expect, it } from 'vitest';
import { loadEnv } from './env.js';

const base = {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://user:pass@localhost:5432/knowledgeos',
  REDIS_URL: 'redis://localhost:6379',
  QDRANT_URL: 'http://localhost:6333',
};

describe('loadEnv', () => {
  it('applies defaults for optional values', () => {
    const env = loadEnv(base);

    expect(env.HOST).toBe('127.0.0.1');
    expect(env.PORT).toBe(3000);
    expect(env.LOG_LEVEL).toBe('info');
  });

  it('names the missing required field without printing its value', () => {
    expect(() => loadEnv({ ...base, DATABASE_URL: undefined })).toThrow(/DATABASE_URL/);
  });

  it('rejects an invalid port', () => {
    expect(() => loadEnv({ ...base, PORT: '70000' })).toThrow(/PORT/);
  });
});
