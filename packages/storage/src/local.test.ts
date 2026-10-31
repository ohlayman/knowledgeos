import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LocalStorageAdapter, buildObjectKey } from './local.js';

let root: string;
let storage: LocalStorageAdapter;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'kos-storage-'));
  storage = new LocalStorageAdapter(root);
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('LocalStorageAdapter', () => {
  it('writes and reads an object by key', async () => {
    const key = buildObjectKey('a'.repeat(64));

    await storage.put(key, Buffer.from('hello world'), 'text/plain');

    const body = await storage.get(key);
    expect(body.toString('utf8')).toBe('hello world');
  });

  it('returns a readable stream', async () => {
    const key = buildObjectKey('b'.repeat(64));
    await storage.put(key, Buffer.from('streamed'), 'text/plain');

    const stream = await storage.getStream(key);
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(Buffer.from(chunk));
    }

    expect(Buffer.concat(chunks).toString('utf8')).toBe('streamed');
  });

  it('reports existence and deletes an object', async () => {
    const key = buildObjectKey('c'.repeat(64));
    expect(await storage.exists(key)).toBe(false);

    await storage.put(key, Buffer.from('x'), 'text/plain');
    expect(await storage.exists(key)).toBe(true);

    await storage.delete(key);
    expect(await storage.exists(key)).toBe(false);
  });

  it('rejects path traversal keys', async () => {
    await expect(storage.put('../escape', Buffer.from('x'), 'text/plain')).rejects.toThrow(
      /invalid key/,
    );
    await expect(storage.get('..\\escape')).rejects.toThrow(/invalid key/);
  });
});

describe('buildObjectKey', () => {
  it('uses the hash prefix as two directory levels', () => {
    expect(buildObjectKey('abcdef' + '0'.repeat(58))).toBe(`ab/cd/abcdef${'0'.repeat(58)}`);
  });

  it('rejects non-sha256 input', () => {
    expect(() => buildObjectKey('not-a-hash')).toThrow(/invalid hash/);
  });
});
