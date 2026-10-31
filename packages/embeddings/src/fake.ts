import { createHash } from 'node:crypto';
import type { EmbeddingProvider } from './types.js';
import { normalizeVector } from './vector.js';

export class FakeEmbeddingProvider implements EmbeddingProvider {
  readonly model = 'fake-embedding';
  readonly dim: number;

  constructor(dim = 1536) {
    this.dim = dim;
  }

  async embed(texts: string[]): Promise<number[][]> {
    return texts.map((text) => this.vector(text));
  }

  private vector(text: string): number[] {
    const digest = createHash('sha256').update(text).digest();
    let state = digest.readUInt32LE(0) || 1;
    const values: number[] = [];

    for (let index = 0; index < this.dim; index += 1) {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      values.push((state / 0xffffffff) * 2 - 1);
    }

    return normalizeVector(values);
  }
}
