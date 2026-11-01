import type { ChatMessage } from './types.js';

export const EXTRACTION_PROMPT_VERSION = 'v1';

const SCHEMA = `{
  "entities": [{ "name": string, "type": "concept|technology|project|agent|protocol", "aliases": string[] }],
  "relations": [{ "from": string, "to": string, "type": "RELATED_TO|DEPENDS_ON|USES|IMPLEMENTS|REFERENCES|PART_OF|COMPETES_WITH|EXTENDS|CONFLICTS_WITH", "confidence": number }],
  "facts": [{ "subject": string, "predicate": string, "value": string, "valueType": "number|boolean|version|text" }]
}`;

const RULES = [
  '你是知识抽取器，只输出 JSON，不要解释。',
  '实体必须是稳定名词；单次出现的临时说法不要抽取。',
  '关系类型只能从给定枚举中选择，不得发明新类型。',
  '事实的值必须可判定（数值、布尔、版本号、明确断言），不要抽取评价性内容。',
  '只抽取文本中明确出现的内容，不得补充外部知识。',
];

export interface ExtractionPromptInput {
  text: string;
  contextBefore?: string;
  contextAfter?: string;
  knownEntities?: string[];
  entitiesOnly?: boolean;
}

export function buildExtractionPrompt(input: ExtractionPromptInput): ChatMessage[] {
  const rules = [...RULES];
  if (input.entitiesOnly) {
    rules.push('预算受限：只抽取实体，relations 与 facts 必须返回空数组。');
  }

  const known =
    input.knownEntities && input.knownEntities.length > 0
      ? `已有实体（同名请直接复用名称）：${input.knownEntities.slice(0, 50).join('、')}`
      : '已有实体：无';

  const context = [
    input.contextBefore ? `前文：${input.contextBefore}` : '',
    input.contextAfter ? `后文：${input.contextAfter}` : '',
  ]
    .filter(Boolean)
    .join('\n');

  return [
    { role: 'system', content: `${rules.join('\n')}\n输出结构：${SCHEMA}` },
    {
      role: 'user',
      content: `${known}\n${context ? `${context}\n` : ''}待抽取文本：\n${input.text}`,
    },
  ];
}
