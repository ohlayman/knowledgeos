import { normalizeEntityName } from '@kos/shared';

export type OwnershipPageType =
  'concept' | 'technology' | 'project' | 'comparison' | 'research' | 'source';

export type OwnershipEntityType = 'concept' | 'technology' | 'project' | 'agent' | 'protocol';

export interface PageCandidate {
  id: string;
  slug: string;
  title: string;
  aliases: string[];
  type: OwnershipPageType;
  evidenceChunkIds: string[];
}

export interface OwnershipEntity {
  name: string;
  type: OwnershipEntityType;
  sourceChunkIds: string[];
}

export type OwnershipLevel = 'exact' | 'structure' | 'semantic' | 'none';

export interface OwnershipDecision {
  kind: 'existing' | 'new' | 'merge_suggestion';
  level: OwnershipLevel;
  pageId: string | null;
  scores: {
    structureDistance?: number;
    structureThreshold?: number;
    semantic?: number;
  };
}

const PAGE_TYPE_BY_ENTITY: Record<OwnershipEntityType, OwnershipPageType> = {
  concept: 'concept',
  technology: 'technology',
  project: 'project',
  agent: 'technology',
  protocol: 'technology',
};

export function pageTypeForEntity(type: OwnershipEntityType): OwnershipPageType {
  return PAGE_TYPE_BY_ENTITY[type];
}

export function levenshtein(a: string, b: string): number {
  if (a === b) {
    return 0;
  }
  const previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    let diagonal = previous[0]!;
    previous[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const temp = previous[j]!;
      previous[j] = Math.min(
        previous[j]! + 1,
        previous[j - 1]! + 1,
        diagonal + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
      diagonal = temp;
    }
  }
  return previous[b.length]!;
}

function sharesSource(entity: OwnershipEntity, page: PageCandidate): boolean {
  return entity.sourceChunkIds.some((chunkId) => page.evidenceChunkIds.includes(chunkId));
}

function containsEachOther(a: string, b: string): boolean {
  if (a.length === b.length) {
    return false;
  }
  const [shorter, longer] = a.length < b.length ? [a, b] : [b, a];
  return longer.includes(shorter) && longer.length - shorter.length >= 2;
}

export async function judgeOwnership(input: {
  entity: OwnershipEntity;
  pages: PageCandidate[];
  similarity: (entityName: string, pageTitle: string) => Promise<number>;
  semanticThreshold?: number;
  mergeThreshold?: number;
}): Promise<OwnershipDecision> {
  const normalizedName = normalizeEntityName(input.entity.name);
  const expectedType = PAGE_TYPE_BY_ENTITY[input.entity.type];
  const semanticThreshold = input.semanticThreshold ?? 0.85;
  const mergeThreshold = input.mergeThreshold ?? 0.7;

  for (const page of input.pages) {
    const names = [page.title, ...page.aliases].map((value) => normalizeEntityName(value));
    if (names.includes(normalizedName)) {
      return { kind: 'existing', level: 'exact', pageId: page.id, scores: {} };
    }
  }

  for (const page of input.pages) {
    if (page.type !== expectedType || !sharesSource(input.entity, page)) {
      continue;
    }
    const title = normalizeEntityName(page.title);
    const distance = levenshtein(normalizedName, title);
    const threshold = Math.min(3, Math.max(1, Math.floor(title.length * 0.25)));
    if (distance <= threshold) {
      return {
        kind: 'existing',
        level: 'structure',
        pageId: page.id,
        scores: { structureDistance: distance, structureThreshold: threshold },
      };
    }
  }

  let bestMerge: OwnershipDecision | null = null;
  for (const page of input.pages) {
    if (page.type !== expectedType) {
      continue;
    }
    const title = normalizeEntityName(page.title);
    const similarity = await input.similarity(normalizedName, title);

    if (sharesSource(input.entity, page) && similarity >= semanticThreshold) {
      if (containsEachOther(normalizedName, title)) {
        bestMerge ??= {
          kind: 'merge_suggestion',
          level: 'semantic',
          pageId: page.id,
          scores: { semantic: similarity },
        };
        continue;
      }
      return {
        kind: 'existing',
        level: 'semantic',
        pageId: page.id,
        scores: { semantic: similarity },
      };
    }

    if (sharesSource(input.entity, page) && similarity >= mergeThreshold && bestMerge === null) {
      bestMerge = {
        kind: 'merge_suggestion',
        level: 'semantic',
        pageId: page.id,
        scores: { semantic: similarity },
      };
    }
  }

  return bestMerge ?? { kind: 'new', level: 'none', pageId: null, scores: {} };
}
