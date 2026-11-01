import { createHash } from 'node:crypto';

export function slugify(title: string): string {
  const slug = title
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');

  if (slug.length > 0) {
    return slug.slice(0, 200);
  }

  const hash = createHash('sha256').update(title).digest('hex').slice(0, 8);
  return `page-${hash}`;
}
