import { Redis } from 'ioredis';
import { Pool } from 'pg';
import type { Env } from '@kos/shared';

export interface Pingable {
  ping(): Promise<void>;
}

export interface Closable {
  close(): Promise<void>;
}

export interface AppDeps {
  env: Env;
  db: Pingable & Closable;
  redis: Pingable & Closable;
  qdrant: Pingable;
}

export function createDeps(env: Env): AppDeps {
  const pool = new Pool({
    connectionString: env.DATABASE_URL,
    max: 10,
    connectionTimeoutMillis: 3000,
  });

  const redis = new Redis(env.REDIS_URL, {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    connectTimeout: 3000,
  });

  // Health checks report connection failures through ping(); keep the process
  // alive instead of letting ioredis emit an unhandled error event.
  redis.on('error', () => undefined);

  return {
    env,
    db: {
      async ping() {
        await pool.query('SELECT 1');
      },
      async close() {
        await pool.end();
      },
    },
    redis: {
      async ping() {
        if (redis.status === 'wait' || redis.status === 'end') {
          await redis.connect();
        }
        await redis.ping();
      },
      async close() {
        await redis.quit();
      },
    },
    qdrant: {
      async ping() {
        const response = await fetch(new URL('/healthz', env.QDRANT_URL), {
          headers: env.QDRANT_API_KEY ? { 'api-key': env.QDRANT_API_KEY } : {},
          signal: AbortSignal.timeout(3000),
        });
        if (!response.ok) {
          throw new Error(`Qdrant health check failed with status ${response.status}`);
        }
      },
    },
  };
}
