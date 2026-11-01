import type { ChatMessage, ExtractionModel } from './types.js';

const KNOWN_TERMS = [
  '混合检索',
  '向量召回',
  '关键词召回',
  '向量数据库',
  '知识图谱',
  '引用后校验',
  '倒排索引',
  '分块',
  '嵌入',
  '重排',
];

const TECHNOLOGY_TERMS = new Set([
  'Qdrant',
  'PostgreSQL',
  'Redis',
  'BullMQ',
  'Prisma',
  'Fastify',
  'React',
  'RRF',
]);

function extractTerms(text: string): string[] {
  const found = new Set<string>();
  for (const term of KNOWN_TERMS) {
    if (text.includes(term)) {
      found.add(term);
    }
  }
  for (const match of text.matchAll(/[A-Z][A-Za-z0-9_-]{2,}/g)) {
    found.add(match[0]);
  }
  return [...found];
}

/**
 * 无真实模型时使用：用确定性规则产出符合抽取 Schema 的 JSON，保证开发与验收链路可跑通。
 */
export class FakeExtractionModel implements ExtractionModel {
  readonly model = 'fake-extractor';

  async complete(messages: ChatMessage[]): Promise<{ text: string }> {
    const user = messages.at(-1)?.content ?? '';
    const marker = user.indexOf('待抽取文本：');
    const text = marker >= 0 ? user.slice(marker + '待抽取文本：'.length) : user;
    const entitiesOnly = user.includes('只抽取实体');

    const entities = extractTerms(text).map((name) => ({
      name,
      type: TECHNOLOGY_TERMS.has(name) ? 'technology' : 'concept',
      aliases: [],
    }));

    const facts: Array<{
      subject: string;
      predicate: string;
      value: string;
      valueType: string;
    }> = [];
    if (!entitiesOnly && entities[0]) {
      for (const segment of text.split(/[。；\n]/)) {
        const numeric =
          segment.match(
            /([A-Za-z一-龥-]{2,30})\s*默认\s*([A-Za-z一-龥 -]{1,20}?)\s*(?:是|为)?\s*([0-9]+(?:\.[0-9]+)?)/,
          ) ??
          segment.match(
            /([A-Za-z一-龥-]{2,30})\s*的\s*([A-Za-z一-龥 -]{1,20}?)\s*默认\s*(?:是|为)?\s*([0-9]+(?:\.[0-9]+)?)/,
          );
        if (numeric) {
          facts.push({
            subject: entities[0].name,
            predicate: `${numeric[2]!.trim()}默认`,
            value: numeric[3]!,
            valueType: 'number',
          });
        }
        const polarity = segment.match(/(支持|不支持)\s*([A-Za-z一-龥-]{2,20})/);
        if (polarity) {
          facts.push({
            subject: entities[0].name,
            predicate: `支持${polarity[2]!.trim()}`,
            value: polarity[1]!,
            valueType: 'boolean',
          });
        }
      }
    }

    const result = {
      entities,
      relations: entitiesOnly
        ? []
        : entities.slice(1).map((entity) => ({
            from: entities[0]!.name,
            to: entity.name,
            type: 'RELATED_TO',
            confidence: 0.6,
          })),
      facts,
    };

    return { text: JSON.stringify(result) };
  }
}
