import { fromMarkdown } from 'mdast-util-from-markdown';
import { gfmFromMarkdown } from 'mdast-util-gfm';
import { gfm } from 'micromark-extension-gfm';
import { DocumentBuilder } from './document-builder.js';
import type { ParsedDocument } from './types.js';

interface MdNode {
  type: string;
  value?: string;
  alt?: string;
  lang?: string | null;
  depth?: number;
  ordered?: boolean;
  start?: number | null;
  children?: MdNode[];
}

function inlineText(node: MdNode): string {
  switch (node.type) {
    case 'text':
    case 'inlineCode':
      return node.value ?? '';
    case 'break':
      return '\n';
    case 'image':
      return node.alt ?? '';
    case 'html':
      return '';
    default:
      return (node.children ?? []).map(inlineText).join('');
  }
}

function blockText(node: MdNode): string {
  return (node.children ?? [])
    .map((child) => {
      switch (child.type) {
        case 'paragraph':
        case 'heading':
        case 'tableCell':
          return inlineText(child);
        case 'code':
          return child.value ?? '';
        case 'list':
          return listText(child);
        case 'table':
          return tableText(child);
        case 'blockquote':
          return blockText(child);
        default:
          return inlineText(child);
      }
    })
    .map((value) => value.trim())
    .filter((value) => value.length > 0)
    .join('\n');
}

function listText(node: MdNode): string {
  const items = node.children ?? [];
  return items
    .map((item, index) => {
      const marker = node.ordered ? `${(node.start ?? 1) + index}. ` : '- ';
      return `${marker}${blockText(item)}`;
    })
    .join('\n');
}

function tableText(node: MdNode): string {
  return (node.children ?? [])
    .map((row) => (row.children ?? []).map((cell) => inlineText(cell).trim()).join(' | '))
    .join('\n');
}

function emitNode(builder: DocumentBuilder, node: MdNode): void {
  switch (node.type) {
    case 'heading':
      builder.add('heading', inlineText(node), { level: node.depth ?? 1 });
      return;
    case 'paragraph':
      builder.add('paragraph', inlineText(node));
      return;
    case 'list':
      builder.add('list', listText(node));
      return;
    case 'code':
      builder.add('code', node.value ?? '', {
        ...(node.lang ? { language: node.lang } : {}),
      });
      return;
    case 'table':
      builder.add('table', tableText(node));
      return;
    case 'blockquote':
      builder.add('quote', blockText(node));
      return;
    default:
      return;
  }
}

export function parseMarkdown(raw: string): ParsedDocument {
  const builder = new DocumentBuilder();
  if (raw.trim().length === 0) {
    return builder.build();
  }

  const tree = fromMarkdown(raw, {
    extensions: [gfm()],
    mdastExtensions: [gfmFromMarkdown()],
  }) as unknown as MdNode;
  let title: string | undefined;
  for (const node of tree.children ?? []) {
    if (title === undefined && node.type === 'heading') {
      title = inlineText(node);
    }
    emitNode(builder, node);
  }

  builder.setTitle(title);

  return builder.build();
}
