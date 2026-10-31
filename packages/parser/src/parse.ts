import { ApiError } from '@kos/shared';
import { parseHtml } from './html.js';
import { parseMarkdown } from './markdown.js';
import { parsePdf } from './pdf.js';
import { parsePlainText } from './plaintext.js';
import type { ParsedDocument } from './types.js';

export async function parseDocument(mimeType: string, data: Buffer): Promise<ParsedDocument> {
  switch (mimeType) {
    case 'application/pdf':
      return parsePdf(data);
    case 'text/html':
      return parseHtml(data.toString('utf8'));
    case 'text/markdown':
      return parseMarkdown(data.toString('utf8'));
    case 'text/plain':
      return parsePlainText(data.toString('utf8'));
    default:
      throw new ApiError('UNSUPPORTED_FORMAT', `不支持的 MIME 类型: ${mimeType}`);
  }
}
