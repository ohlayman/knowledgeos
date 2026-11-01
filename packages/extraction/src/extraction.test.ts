import { describe, expect, it, vi } from 'vitest';
import {
  ExtractionResultSchema,
  extractChunk,
  parseExtraction,
  type ExtractionCache,
  type ExtractionModel,
} from './index.js';

const chunkId = '11111111-1111-4111-8111-111111111111';

const validPayload = {
  entities: [
    { name: '混合检索', type: 'concept', aliases: ['Hybrid Retrieval'], evidenceChunkId: chunkId },
  ],
  relations: [],
  facts: [
    {
      subject: '混合检索',
      predicate: '默认融合参数',
      value: '60',
      valueType: 'number',
      evidenceChunkId: chunkId,
    },
  ],
};

function modelReturning(...outputs: string[]): ExtractionModel & { calls: number } {
  let calls = 0;
  return {
    model: 'test-model',
    get calls() {
      return calls;
    },
    async complete() {
      const output = outputs[Math.min(calls, outputs.length - 1)]!;
      calls += 1;
      return { text: output };
    },
  };
}

function memoryCache(initial?: unknown): ExtractionCache & { size: number } {
  const store = new Map<string, unknown>();
  if (initial) {
    store.set(`key`, initial);
  }
  return {
    get size() {
      return store.size;
    },
    async get() {
      const hit = store.get('key');
      return hit ? (hit as never) : null;
    },
    async set(_chunkId, _model, _version, result) {
      store.set('key', result);
    },
  };
}

describe('parseExtraction', () => {
  it('接受带代码围栏的 JSON 并补齐默认值', () => {
    const parsed = parseExtraction('```json\n' + JSON.stringify(validPayload) + '\n```');

    expect(parsed).not.toBeNull();
    expect(parsed!.entities[0]?.name).toBe('混合检索');
    expect(parsed!.entities[0]?.aliases).toEqual(['Hybrid Retrieval']);
    expect(parsed!.facts[0]?.value).toBe('60');
  });

  it('缺少必填字段时返回 null', () => {
    const parsed = parseExtraction(JSON.stringify({ entities: [{ type: 'concept' }] }));
    expect(parsed).toBeNull();
  });

  it('拒绝未定义的实体类型', () => {
    const parsed = parseExtraction(
      JSON.stringify({
        ...validPayload,
        entities: [{ ...validPayload.entities[0], type: 'alien' }],
      }),
    );
    expect(parsed).toBeNull();
  });

  it('Schema 输出去掉超出范围的证据块，由调用方覆盖为当前块', () => {
    const parsed = ExtractionResultSchema.parse({
      ...validPayload,
      relations: [
        {
          from: '混合检索',
          to: '向量召回',
          type: 'USES',
          evidenceChunkId: '99999999-9999-4999-8999-999999999999',
          confidence: 0.8,
        },
      ],
    });
    expect(parsed.relations[0]?.confidence).toBe(0.8);
  });
});

describe('extractChunk', () => {
  it('解析成功时返回结果并写缓存', async () => {
    const model = modelReturning(JSON.stringify(validPayload));
    const cache = memoryCache();

    const outcome = await extractChunk(
      { chunkId, text: '混合检索同时使用两路召回。' },
      { model, cache },
    );

    expect(outcome.status).toBe('ok');
    if (outcome.status === 'ok') {
      expect(outcome.result.entities).toHaveLength(1);
      expect(outcome.cached).toBe(false);
      expect(outcome.attempts).toBe(1);
    }
    expect(cache.size).toBe(1);
    expect(model.calls).toBe(1);
  });

  it('缓存命中时不调用模型', async () => {
    const model = modelReturning(JSON.stringify(validPayload));
    const cache = memoryCache(validPayload);

    const outcome = await extractChunk({ chunkId, text: '混合检索' }, { model, cache });

    expect(outcome.status).toBe('ok');
    if (outcome.status === 'ok') {
      expect(outcome.cached).toBe(true);
    }
    expect(model.calls).toBe(0);
  });

  it('第一次输出非法时重试一次，仍然非法则跳过', async () => {
    const model = modelReturning('not json', '{"entities":"nope"}');
    const outcome = await extractChunk(
      { chunkId, text: '混合检索' },
      { model, cache: memoryCache() },
    );

    expect(outcome.status).toBe('skipped');
    if (outcome.status === 'skipped') {
      expect(outcome.reason).toBe('schema_invalid');
    }
    expect(model.calls).toBe(2);
  });

  it('第一次失败、第二次合法时成功', async () => {
    const model = modelReturning('not json', JSON.stringify(validPayload));
    const outcome = await extractChunk(
      { chunkId, text: '混合检索' },
      { model, cache: memoryCache() },
    );

    expect(outcome.status).toBe('ok');
    if (outcome.status === 'ok') {
      expect(outcome.attempts).toBe(2);
    }
  });

  it('预算不足时降级为只抽实体', async () => {
    const model = modelReturning(JSON.stringify(validPayload));
    const complete = vi.spyOn(model, 'complete');

    const outcome = await extractChunk(
      { chunkId, text: '混合检索', tokenBudgetLeft: 100 },
      { model, cache: memoryCache() },
    );

    expect(outcome.status).toBe('ok');
    if (outcome.status === 'ok') {
      expect(outcome.entitiesOnly).toBe(true);
      expect(outcome.result.facts).toHaveLength(0);
    }
    expect(
      complete.mock.calls[0]?.[0].some((message) => message.content.includes('只抽取实体')),
    ).toBe(true);
  });

  it('预算耗尽时直接跳过', async () => {
    const model = modelReturning(JSON.stringify(validPayload));
    const outcome = await extractChunk(
      { chunkId, text: '混合检索', tokenBudgetLeft: 10 },
      { model, cache: memoryCache() },
    );

    expect(outcome.status).toBe('skipped');
    if (outcome.status === 'skipped') {
      expect(outcome.reason).toBe('budget_exhausted');
    }
  });
});
