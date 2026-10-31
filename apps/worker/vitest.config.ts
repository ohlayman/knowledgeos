import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@kos/chunking': fileURLToPath(
        new URL('../../packages/chunking/src/index.ts', import.meta.url),
      ),
      '@kos/database': fileURLToPath(
        new URL('../../packages/database/src/index.ts', import.meta.url),
      ),
      '@kos/embeddings': fileURLToPath(
        new URL('../../packages/embeddings/src/index.ts', import.meta.url),
      ),
      '@kos/parser': fileURLToPath(new URL('../../packages/parser/src/index.ts', import.meta.url)),
      '@kos/queue': fileURLToPath(new URL('../../packages/queue/src/index.ts', import.meta.url)),
      '@kos/retrieval': fileURLToPath(
        new URL('../../packages/retrieval/src/index.ts', import.meta.url),
      ),
      '@kos/shared': fileURLToPath(new URL('../../packages/shared/src/index.ts', import.meta.url)),
      '@kos/storage': fileURLToPath(
        new URL('../../packages/storage/src/index.ts', import.meta.url),
      ),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    testTimeout: 30_000,
  },
});
