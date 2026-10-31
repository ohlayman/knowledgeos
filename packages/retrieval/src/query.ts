import type { QueryUnderstanding, QueryUnderstandingResult, QuestionType } from './types.js';

const COMPARISON_PATTERN = /区别|对比|差异|有什么不同|\bvs\.?\b|versus/i;
const PROCEDURE_PATTERN = /如何|怎么|怎样|步骤|流程|如何做/;
const FACT_PATTERN = /是什么|什么是|谁|何时|多少|哪年|吗|？|\?/;

export function detectQuestionType(question: string): QuestionType {
  if (COMPARISON_PATTERN.test(question)) {
    return 'comparison';
  }
  if (PROCEDURE_PATTERN.test(question)) {
    return 'procedure';
  }
  if (FACT_PATTERN.test(question)) {
    return 'fact';
  }
  return 'open';
}

export function extractEntities(question: string): string[] {
  const quoted = [...question.matchAll(/[「“"']([^」”"']{2,30})[」”"']/g)]
    .map((match) => match[1]?.trim() ?? '')
    .filter(Boolean);
  if (quoted.length >= 2) {
    return quoted.slice(0, 10);
  }

  const parts = question
    .split(/(?:和|与|跟|及|\bvs\.?\b)/i)
    .map((part) => part.split(/(?:有?什么|怎么|如何|区别|差异|对比)/)[0] ?? '')
    .map((part) => part.replace(/[？?。，,、\s]+$/g, '').trim())
    .filter((part) => part.length >= 2 && part.length <= 50);

  return parts.slice(0, 10);
}

export class RuleBasedQueryUnderstanding implements QueryUnderstanding {
  async understand(question: string): Promise<QueryUnderstandingResult> {
    const questionType = detectQuestionType(question);
    const entities = questionType === 'comparison' ? extractEntities(question) : [];

    return {
      rewrittenQuery: question.trim(),
      entities,
      questionType,
      keywordHints: entities,
    };
  }
}
