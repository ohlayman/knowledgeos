import { fileURLToPath } from 'node:url';
import { config as loadDotenv } from 'dotenv';
import { loadEnv } from '@kos/shared';
import { buildApp } from './app.js';
import { createDeps } from './deps.js';

loadDotenv({ path: fileURLToPath(new URL('../../../.env', import.meta.url)) });

const env = loadEnv();
const deps = createDeps(env);
const app = buildApp(deps);

async function shutdown(signal: string): Promise<void> {
  app.log.info({ signal }, 'shutting down');
  await app.close();
  await deps.db.close();
  await deps.redis.close();
  process.exit(0);
}

process.on('SIGINT', () => {
  void shutdown('SIGINT');
});
process.on('SIGTERM', () => {
  void shutdown('SIGTERM');
});

try {
  await app.listen({ host: env.HOST, port: env.PORT });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
