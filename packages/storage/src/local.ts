import { randomUUID } from 'node:crypto';
import { access, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { dirname, resolve, sep } from 'node:path';
import type { Readable } from 'node:stream';

export interface StorageAdapter {
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<Buffer>;
  getStream(key: string): Promise<Readable>;
  exists(key: string): Promise<boolean>;
  delete(key: string): Promise<void>;
}

const KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9/_-]*$/;
const HASH_PATTERN = /^[a-f0-9]{64}$/;

export function buildObjectKey(hash: string): string {
  if (!HASH_PATTERN.test(hash)) {
    throw new Error(`invalid hash: ${hash}`);
  }

  return `${hash.slice(0, 2)}/${hash.slice(2, 4)}/${hash}`;
}

export class LocalStorageAdapter implements StorageAdapter {
  private readonly objectsRoot: string;

  constructor(rootDir: string) {
    this.objectsRoot = resolve(rootDir, 'objects');
  }

  async put(key: string, body: Buffer, _contentType: string): Promise<void> {
    const target = this.resolveKey(key);
    await mkdir(dirname(target), { recursive: true });

    const temporary = `${target}.tmp-${randomUUID()}`;
    await writeFile(temporary, body);
    await rename(temporary, target);
  }

  async get(key: string): Promise<Buffer> {
    return readFile(this.resolveKey(key));
  }

  async getStream(key: string): Promise<Readable> {
    return createReadStream(this.resolveKey(key));
  }

  async exists(key: string): Promise<boolean> {
    try {
      await access(this.resolveKey(key));
      return true;
    } catch {
      return false;
    }
  }

  async delete(key: string): Promise<void> {
    await rm(this.resolveKey(key), { force: true });
  }

  private resolveKey(key: string): string {
    if (!KEY_PATTERN.test(key) || key.includes('..') || key.includes('\\')) {
      throw new Error(`invalid key: ${key}`);
    }

    const target = resolve(this.objectsRoot, key);
    if (!target.startsWith(this.objectsRoot + sep)) {
      throw new Error(`invalid key: ${key}`);
    }

    return target;
  }
}
