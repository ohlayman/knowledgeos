export interface PdfRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type ParsedBlockKind = 'heading' | 'paragraph' | 'list' | 'code' | 'table' | 'quote';

export interface ParsedBlock {
  kind: ParsedBlockKind;
  text: string;
  startOffset: number;
  endOffset: number;
  level?: number;
  pageNumber?: number;
  rects?: PdfRect[];
  language?: string;
}

export interface ParsedPage {
  pageNumber: number;
  startOffset: number;
  endOffset: number;
}

export interface ParsedDocument {
  /** 规范化纯文本；偏移坐标系为 UTF-16 code unit。 */
  text: string;
  pages: ParsedPage[];
  blocks: ParsedBlock[];
  metadata: {
    title?: string;
    language?: string;
    author?: string;
    wordCount: number;
  };
  warnings: string[];
}
