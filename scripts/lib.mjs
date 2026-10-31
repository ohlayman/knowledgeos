import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export function loadEnvFile() {
  const path = resolve(repoRoot, '.env');
  if (!existsSync(path)) {
    return {};
  }

  const env = {};
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }
    const index = trimmed.indexOf('=');
    if (index <= 0) {
      continue;
    }
    env[trimmed.slice(0, index)] = trimmed.slice(index + 1).replace(/^['"]|['"]$/g, '');
  }
  return env;
}

export function databaseTarget(databaseUrl) {
  const url = new URL(databaseUrl);
  return {
    user: decodeURIComponent(url.username || 'kos'),
    database: url.pathname.replace(/^\//, '') || 'knowledgeos',
  };
}

function dockerBinary() {
  if (process.env.DOCKER_BIN) {
    return process.env.DOCKER_BIN;
  }
  const windowsDefault =
    'C:/Users/HP/AppData/Local/Programs/DockerDesktop/resources/bin/docker.exe';
  if (process.platform === 'win32' && existsSync(windowsDefault)) {
    return windowsDefault;
  }
  return 'docker';
}

export function runPgDump(databaseUrl, file) {
  try {
    execFileSync('pg_dump', ['-Fc', '-f', file, databaseUrl], { stdio: 'inherit' });
    return 'host';
  } catch (error) {
    if (error.code !== 'ENOENT') {
      throw error;
    }
  }

  const { user, database } = databaseTarget(databaseUrl);
  const docker = dockerBinary();
  const buffer = execFileSync(
    docker,
    ['compose', 'exec', '-T', 'postgres', 'pg_dump', '-Fc', '-U', user, database],
    { cwd: repoRoot, maxBuffer: 2 * 1024 * 1024 * 1024 },
  );
  return { mode: 'docker', buffer };
}

export function runPgRestore(databaseUrl, file, dumpBuffer) {
  try {
    execFileSync('pg_restore', ['--clean', '--if-exists', '--no-owner', '-d', databaseUrl, file], {
      stdio: 'inherit',
    });
    return 'host';
  } catch (error) {
    if (error.code !== 'ENOENT') {
      throw error;
    }
  }

  const { user, database } = databaseTarget(databaseUrl);
  const docker = dockerBinary();
  execFileSync(
    docker,
    [
      'compose',
      'exec',
      '-T',
      'postgres',
      'pg_restore',
      '--clean',
      '--if-exists',
      '--no-owner',
      '-U',
      user,
      '-d',
      database,
    ],
    { cwd: repoRoot, input: dumpBuffer, stdio: ['pipe', 'inherit', 'inherit'] },
  );
  return 'docker';
}

export function sha256(bufferOrPath) {
  const data = Buffer.isBuffer(bufferOrPath) ? bufferOrPath : readFileSync(bufferOrPath);
  return createHash('sha256').update(data).digest('hex');
}
