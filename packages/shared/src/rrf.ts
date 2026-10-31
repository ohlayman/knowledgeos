import { buildSearchText } from './bigram.js';

export interface RankedItem {
  id: string;
}

export interface FusedItem {
  id: string;
  score: number;
}

export function rrf(lists: RankedItem[][], k = 60): FusedItem[] {
  const scores = new Map<string, number>();
  const bestRank = new Map<string, number>();

  for (const list of lists) {
    list.forEach((item, index) => {
      scores.set(item.id, (scores.get(item.id) ?? 0) + 1 / (k + index + 1));
      const current = bestRank.get(item.id);
      if (current === undefined || index < current) {
        bestRank.set(item.id, index);
      }
    });
  }

  return [...scores.entries()]
    .map(([id, score]) => ({ id, score }))
    .sort(
      (a, b) =>
        b.score - a.score ||
        (bestRank.get(a.id) ?? 0) - (bestRank.get(b.id) ?? 0) ||
        a.id.localeCompare(b.id),
    );
}

export function buildTsQuery(question: string, maxTokens = 24): string {
  const tokens = buildSearchText(question).split(' ').filter(Boolean).slice(0, maxTokens);
  if (tokens.length === 0) {
    return '';
  }

  const escaped = tokens.map((token) => token.replace(/'/g, "''"));
  if (escaped.length <= 4) {
    return escaped.join(' & ');
  }

  const groups: string[] = [];
  for (let index = 0; index < escaped.length; index += 4) {
    groups.push(escaped.slice(index, index + 4).join(' & '));
  }

  return groups.join(' | ');
}
