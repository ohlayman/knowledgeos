export interface ConflictFact {
  subject: string;
  predicate: string;
  value: string;
  evidenceChunkId: string;
  observedAt?: string;
}

export type ConflictType = 'numeric' | 'negation' | 'temporal';

export interface WikiConflict {
  type: ConflictType;
  subject: string;
  predicate: string;
  a: { value: string; evidenceChunkId: string; observedAt?: string };
  b: { value: string; evidenceChunkId: string; observedAt?: string };
  detail: string;
}

const NEGATIVE = /(不支持|不允许|不可用|否|没有|not\b|unsupported|false|no\b)/i;
const POSITIVE = /^(支持|允许|可用|是|true|yes\b)/i;

function numericValue(value: string): number | null {
  const match = value.replace(/,/g, '').match(/-?\d+(\.\d+)?/);
  return match ? Number(match[0]) : null;
}

function isNegationPair(a: string, b: string): boolean {
  const aNegative = NEGATIVE.test(a);
  const bNegative = NEGATIVE.test(b);
  if (aNegative === bNegative) {
    return false;
  }
  const positive = aNegative ? b : a;
  return POSITIVE.test(positive.trim()) || !NEGATIVE.test(positive);
}

function daysApart(a?: string, b?: string): number {
  if (!a || !b) {
    return 0;
  }
  const first = Date.parse(a);
  const second = Date.parse(b);
  if (Number.isNaN(first) || Number.isNaN(second)) {
    return 0;
  }
  return Math.abs(first - second) / (24 * 60 * 60 * 1000);
}

export function detectConflicts(facts: ConflictFact[]): WikiConflict[] {
  const groups = new Map<string, ConflictFact[]>();
  for (const fact of facts) {
    const key = `${fact.subject}::${fact.predicate}`;
    const group = groups.get(key);
    if (group) {
      group.push(fact);
    } else {
      groups.set(key, [fact]);
    }
  }

  const conflicts: WikiConflict[] = [];

  for (const group of groups.values()) {
    const distinct = group.filter(
      (fact, index) => group.findIndex((other) => other.value === fact.value) === index,
    );
    if (distinct.length < 2) {
      continue;
    }

    const [a, b] = distinct as [ConflictFact, ConflictFact];
    const numericA = numericValue(a.value);
    const numericB = numericValue(b.value);
    const base = {
      subject: a.subject,
      predicate: a.predicate,
      a: {
        value: a.value,
        evidenceChunkId: a.evidenceChunkId,
        ...(a.observedAt ? { observedAt: a.observedAt } : {}),
      },
      b: {
        value: b.value,
        evidenceChunkId: b.evidenceChunkId,
        ...(b.observedAt ? { observedAt: b.observedAt } : {}),
      },
    };

    if (numericA !== null && numericB !== null && numericA !== numericB) {
      conflicts.push({
        ...base,
        type: 'numeric',
        detail: `同一谓词出现不同数值：${numericA} vs ${numericB}`,
      });
      continue;
    }

    if (isNegationPair(a.value, b.value)) {
      conflicts.push({
        ...base,
        type: 'negation',
        detail: `同一谓词出现相反极性：${a.value} vs ${b.value}`,
      });
      continue;
    }

    if (daysApart(a.observedAt, b.observedAt) >= 1) {
      conflicts.push({
        ...base,
        type: 'temporal',
        detail: '两个来源存在时间差异，按版本并列呈现，不判对错',
      });
      continue;
    }

    conflicts.push({
      ...base,
      type: 'temporal',
      detail: '同一谓词存在不同表述，需人工裁决',
    });
  }

  return conflicts;
}
