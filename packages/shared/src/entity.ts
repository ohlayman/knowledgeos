const EDGE_PUNCTUATION = /^[\s\p{P}\p{S}]+|[\s\p{P}\p{S}]+$/gu;
const INNER_PUNCTUATION = /[\p{P}\p{S}]+/gu;
const MULTI_SPACE = /\s+/g;

export function normalizeEntityName(name: string): string {
  const normalized = name
    .normalize('NFKC')
    .toLowerCase()
    .replace(EDGE_PUNCTUATION, '')
    .replace(INNER_PUNCTUATION, ' ')
    .replace(MULTI_SPACE, ' ')
    .trim();

  return normalized
    .split(' ')
    .map((word) => {
      const singularExceptions = /(analysis|basis|axis|series|species)$/;
      const isPlural =
        word.length > 3 &&
        word.endsWith('s') &&
        !word.endsWith('ss') &&
        !word.endsWith('us') &&
        !singularExceptions.test(word);
      return isPlural ? word.slice(0, -1) : word;
    })
    .join(' ');
}
