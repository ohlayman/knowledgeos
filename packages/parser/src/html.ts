import { Readability } from '@mozilla/readability';
import { parseHTML } from 'linkedom';
import { DocumentBuilder } from './document-builder.js';
import type { ParsedDocument } from './types.js';

interface HtmlElement {
  tagName?: string;
  textContent: string | null;
  children: ArrayLike<HtmlElement>;
  getAttribute(name: string): string | null;
  querySelectorAll(selector: string): ArrayLike<HtmlElement>;
}

const CONTAINER_TAGS = new Set([
  'body',
  'html',
  'div',
  'section',
  'article',
  'main',
  'header',
  'li',
  'dd',
  'dt',
  'figure',
]);

const SKIP_TAGS = new Set([
  'script',
  'style',
  'noscript',
  'iframe',
  'form',
  'button',
  'nav',
  'aside',
  'footer',
]);

function childElements(element: HtmlElement): HtmlElement[] {
  const result: HtmlElement[] = [];
  for (let index = 0; index < element.children.length; index += 1) {
    const child = element.children[index];
    if (child) {
      result.push(child);
    }
  }
  return result;
}

function paragraphText(element: HtmlElement): string {
  return (element.textContent ?? '').replace(/\s+/g, ' ').trim();
}

function listText(element: HtmlElement, ordered: boolean): string {
  return childElements(element)
    .filter((child) => child.tagName?.toLowerCase() === 'li')
    .map((item, index) => `${ordered ? `${index + 1}. ` : '- '}${paragraphText(item)}`)
    .join('\n');
}

function tableText(element: HtmlElement): string {
  const rows = element.querySelectorAll('tr');
  const lines: string[] = [];

  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    if (!row) {
      continue;
    }
    const cells = row.querySelectorAll('th,td');
    const values: string[] = [];
    for (let cellIndex = 0; cellIndex < cells.length; cellIndex += 1) {
      const cell = cells[cellIndex];
      if (cell) {
        values.push(paragraphText(cell));
      }
    }
    if (values.length > 0) {
      lines.push(values.join(' | '));
    }
  }

  return lines.join('\n');
}

function walk(element: HtmlElement, builder: DocumentBuilder): void {
  for (const child of childElements(element)) {
    const tag = child.tagName?.toLowerCase() ?? '';
    if (SKIP_TAGS.has(tag)) {
      continue;
    }

    if (/^h[1-6]$/.test(tag)) {
      builder.add('heading', paragraphText(child), { level: Number(tag.slice(1)) });
      continue;
    }
    if (tag === 'p') {
      builder.add('paragraph', paragraphText(child));
      continue;
    }
    if (tag === 'ul' || tag === 'ol') {
      builder.add('list', listText(child, tag === 'ol'));
      continue;
    }
    if (tag === 'pre') {
      builder.add('code', child.textContent ?? '');
      continue;
    }
    if (tag === 'table') {
      builder.add('table', tableText(child));
      continue;
    }
    if (tag === 'blockquote') {
      builder.add('quote', paragraphText(child));
      continue;
    }

    if (CONTAINER_TAGS.has(tag)) {
      walk(child, builder);
    }
  }
}

export function parseHtml(html: string): ParsedDocument {
  const builder = new DocumentBuilder();
  if (html.trim().length === 0) {
    return builder.build();
  }

  const { document } = parseHTML(html);
  const reader = new Readability(
    document as unknown as ConstructorParameters<typeof Readability>[0],
    { charThreshold: 50, keepClasses: false },
  );
  const article = reader.parse();

  const extractedLength = article?.textContent?.trim().length ?? 0;
  const useArticle = extractedLength >= 50 && Boolean(article?.content);
  const contentDocument = useArticle
    ? parseHTML(`<html><body>${article!.content}</body></html>`).document
    : document;

  walk(contentDocument.body as unknown as HtmlElement, builder);

  if (!useArticle) {
    builder.warn('readability_fallback');
  }

  builder.setTitle(builder.firstBlockOfKind('heading')?.text ?? article?.title ?? document.title);
  builder.setAuthor(article?.byline ?? undefined);
  builder.setLanguage(article?.lang ?? document.documentElement.getAttribute('lang') ?? undefined);

  return builder.build();
}
