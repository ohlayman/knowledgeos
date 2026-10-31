import { DocumentBuilder } from './document-builder.js';
import type { ParsedDocument } from './types.js';

export function parsePlainText(raw: string): ParsedDocument {
  const builder = new DocumentBuilder();
  const normalized = raw.replace(/\r\n?/g, '\n');

  for (const paragraph of normalized.split(/\n[ \t]*\n/)) {
    builder.add('paragraph', paragraph);
  }

  return builder.build();
}
