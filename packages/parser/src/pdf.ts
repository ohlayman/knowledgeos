import { extractTextItems, getDocumentProxy, getMeta } from 'unpdf';
import { ApiError } from '@kos/shared';
import { DocumentBuilder } from './document-builder.js';
import type { ParsedBlock, ParsedDocument, PdfRect } from './types.js';

interface TextItem {
  str: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fontSize: number;
}

interface TextLine {
  text: string;
  y: number;
  fontSize: number;
  rects: PdfRect[];
}

const MAX_RECTS_PER_BLOCK = 200;

function errorName(error: unknown): string | undefined {
  if (typeof error === 'object' && error !== null) {
    return (error as { name?: string }).name;
  }
  return undefined;
}

export function mapPdfError(error: unknown): Error {
  const name = errorName(error);
  if (name === 'PasswordException') {
    return new ApiError('PDF_PASSWORD_REQUIRED');
  }
  if (name === 'InvalidPDFException') {
    return new ApiError('UNSUPPORTED_FORMAT', 'PDF 文件损坏或格式不合法');
  }
  return error instanceof Error ? error : new ApiError('INTERNAL', 'PDF 解析失败');
}

function joinInline(previous: string, next: string): string {
  if (previous.length === 0) {
    return next;
  }
  const needsSpace = /[A-Za-z0-9,.;:!?)]$/.test(previous) && /^[A-Za-z0-9("'$]/.test(next);
  return needsSpace ? `${previous} ${next}` : `${previous}${next}`;
}

function toRect(item: TextItem): PdfRect {
  return {
    x: item.x,
    y: item.y,
    width: item.width,
    height: item.height > 0 ? item.height : item.fontSize,
  };
}

function toLines(items: TextItem[]): TextLine[] {
  const sorted = items
    .filter((item) => item.str.trim().length > 0)
    .sort((a, b) => b.y - a.y || a.x - b.x);

  const lines: TextLine[] = [];
  for (const item of sorted) {
    const last = lines[lines.length - 1];
    const tolerance = Math.max(2, item.fontSize * 0.5);

    if (last && Math.abs(last.y - item.y) <= tolerance) {
      last.text = joinInline(last.text, item.str.trim());
      last.rects.push(toRect(item));
      continue;
    }

    lines.push({
      text: item.str.trim(),
      y: item.y,
      fontSize: item.fontSize > 0 ? item.fontSize : 10,
      rects: [toRect(item)],
    });
  }

  return lines;
}

function normalizeLine(text: string): string {
  return text.trim().replace(/\s+/g, ' ');
}

function dropRepeatedLines(pages: TextLine[][], totalPages: number): void {
  if (totalPages < 3) {
    return;
  }

  const counts = new Map<string, number>();
  for (const lines of pages) {
    for (const line of lines) {
      const key = normalizeLine(line.text);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }

  const threshold = totalPages * 0.6;
  for (const lines of pages) {
    for (let index = lines.length - 1; index >= 0; index -= 1) {
      if ((counts.get(normalizeLine(lines[index]!.text)) ?? 0) > threshold) {
        lines.splice(index, 1);
      }
    }
  }
}

function splitParagraphs(lines: TextLine[]): TextLine[][] {
  const paragraphs: TextLine[][] = [];
  let current: TextLine[] = [];

  for (const line of lines) {
    const previous = current[current.length - 1];
    if (previous) {
      const gap = previous.y - line.y;
      if (gap > Math.max(previous.fontSize, line.fontSize) * 1.8) {
        paragraphs.push(current);
        current = [];
      }
    }
    current.push(line);
  }

  if (current.length > 0) {
    paragraphs.push(current);
  }

  return paragraphs;
}

export async function parsePdf(input: Buffer | Uint8Array): Promise<ParsedDocument> {
  const builder = new DocumentBuilder();
  const data = new Uint8Array(input);

  let pdf;
  try {
    pdf = await getDocumentProxy(data);
  } catch (error) {
    throw mapPdfError(error);
  }

  const [{ items }, meta] = await Promise.all([
    extractTextItems(pdf),
    getMeta(pdf).catch(() => undefined),
  ]);

  const pages = items.map((pageItems) => toLines(pageItems as TextItem[]));
  dropRepeatedLines(pages, pdf.numPages);

  let characterCount = 0;

  pages.forEach((pageLines, index) => {
    const pageNumber = index + 1;
    const added: ParsedBlock[] = [];

    for (const paragraph of splitParagraphs(pageLines)) {
      const text = paragraph.map((line) => line.text).join('\n');
      const block = builder.add('paragraph', text, {
        pageNumber,
        rects: paragraph.flatMap((line) => line.rects).slice(0, MAX_RECTS_PER_BLOCK),
      });
      if (block) {
        added.push(block);
        characterCount += block.text.length;
      }
    }

    const first = added[0];
    const last = added[added.length - 1];
    if (first && last) {
      builder.addPage({
        pageNumber,
        startOffset: first.startOffset,
        endOffset: last.endOffset,
      });
    }
  });

  if (pdf.numPages > 0 && characterCount / pdf.numPages < 20) {
    builder.warn('needs_ocr');
  }

  const title = meta?.info.Title?.trim();
  const author = meta?.info.Author?.trim();
  const language = meta?.info.Language?.trim() ?? undefined;
  builder.setTitle(title && title.length > 0 ? title : undefined);
  builder.setAuthor(author && author.length > 0 ? author : undefined);
  builder.setLanguage(language);

  return builder.build();
}
