import { isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function resolveDataDir(dataDir: string, moduleUrl: string): string {
  if (isAbsolute(dataDir)) {
    return dataDir;
  }

  const repoRoot = fileURLToPath(new URL('../../../', moduleUrl));
  return resolve(repoRoot, dataDir);
}
