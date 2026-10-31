import type { ParsedBlock, ParsedBlockKind, ParsedDocument, ParsedPage } from './types.js';

type BlockExtras = Omit<ParsedBlock, 'kind' | 'text' | 'startOffset' | 'endOffset'>;

export function countWords(text: string): number {
  return text.match(/[\p{Script=Han}]|[A-Za-z0-9_]+/gu)?.length ?? 0;
}

export class DocumentBuilder {
  private text = '';
  private readonly blocks: ParsedBlock[] = [];
  private readonly pages: ParsedPage[] = [];
  private readonly warnings: string[] = [];
  private title: string | undefined;
  private language: string | undefined;
  private author: string | undefined;

  add(kind: ParsedBlockKind, blockText: string, extras: BlockExtras = {}): ParsedBlock | undefined {
    const value = blockText.trim();
    if (value.length === 0) {
      return undefined;
    }

    if (this.text.length > 0) {
      this.text += '\n\n';
    }
    const startOffset = this.text.length;
    this.text += value;

    const block: ParsedBlock = {
      kind,
      text: value,
      startOffset,
      endOffset: this.text.length,
      ...extras,
    };
    this.blocks.push(block);
    return block;
  }

  firstBlockOfKind(kind: ParsedBlockKind): ParsedBlock | undefined {
    return this.blocks.find((block) => block.kind === kind);
  }

  addPage(page: ParsedPage): void {
    this.pages.push(page);
  }

  warn(message: string): void {
    if (!this.warnings.includes(message)) {
      this.warnings.push(message);
    }
  }

  setTitle(title: string | undefined): void {
    if (title && title.trim().length > 0) {
      this.title = title.trim();
    }
  }

  setLanguage(language: string | undefined): void {
    if (language) {
      this.language = language;
    }
  }

  setAuthor(author: string | undefined): void {
    if (author) {
      this.author = author;
    }
  }

  build(): ParsedDocument {
    return {
      text: this.text,
      pages: this.pages,
      blocks: this.blocks,
      metadata: {
        ...(this.title === undefined ? {} : { title: this.title }),
        ...(this.language === undefined ? {} : { language: this.language }),
        ...(this.author === undefined ? {} : { author: this.author }),
        wordCount: countWords(this.text),
      },
      warnings: this.warnings,
    };
  }
}
