export interface ExtractedWikiLink {
  targetSlug: string;
  relationType: string | null;
  context: string;
}

const LINK_PATTERN = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g;

export function extractWikiLinks(text: string): ExtractedWikiLink[] {
  const links: ExtractedWikiLink[] = [];
  const seen = new Set<string>();

  for (const match of text.matchAll(LINK_PATTERN)) {
    const targetSlug = match[1]!.trim();
    if (targetSlug.length === 0) {
      continue;
    }
    const relationType = match[2]?.trim() || null;
    const key = `${targetSlug}|${relationType ?? ''}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);

    const index = match.index ?? 0;
    const start = Math.max(0, text.lastIndexOf('。', index) + 1);
    const end = text.indexOf('。', index);
    const context = text
      .slice(start, end === -1 ? text.length : end + 1)
      .trim()
      .slice(0, 200);

    links.push({ targetSlug, relationType, context });
  }

  return links;
}
