import { getEncoding, type Tiktoken } from 'js-tiktoken';
import type { ParsedBlock, ParsedDocument, PdfRect } from '@kos/parser';
import { buildSearchText } from '@kos/shared';

export type ChunkDraftType = 'text' | 'code' | 'table' | 'list';

export interface ChunkOptions {
  targetMin: number;
  targetMax: number;
  hardMax: number;
  overlapRatio: number;
}

export interface ChunkDraft {
  index: number;
  text: string;
  tokenCount: number;
  startOffset: number;
  endOffset: number;
  pageStart?: number;
  pageEnd?: number;
  headingPath: string[];
  type: ChunkDraftType;
  location?: { rects?: PdfRect[]; language?: string };
  searchText: string;
}

const DEFAULT_OPTIONS: ChunkOptions = {
  targetMin: 300,
  targetMax: 800,
  hardMax: 1200,
  overlapRatio: 0.1,
};

const MAX_RECTS = 200;

let encoder: Tiktoken | undefined;

function countTokens(text: string): number {
  if (text.length === 0) {
    return 0;
  }
  encoder ??= getEncoding('cl100k_base');
  return encoder.encode(text).length;
}

interface Segment {
  text: string;
  startOffset: number;
  endOffset: number;
  type: ChunkDraftType;
  headingPath: string[];
  pageNumber?: number;
  rects?: PdfRect[];
  language?: string;
}

interface CoreChunk {
  startOffset: number;
  endOffset: number;
  type: ChunkDraftType;
  headingPath: string[];
  pageStart?: number;
  pageEnd?: number;
  rects?: PdfRect[];
  language?: string;
  headerPrefix?: string;
}

interface Sentence {
  text: string;
  startOffset: number;
  endOffset: number;
}

function segmentType(block: ParsedBlock): ChunkDraftType {
  switch (block.kind) {
    case 'code':
      return 'code';
    case 'table':
      return 'table';
    case 'list':
      return 'list';
    default:
      return 'text';
  }
}

function toSegments(doc: ParsedDocument): Segment[] {
  const stack: Array<{ level: number; text: string }> = [];
  const segments: Segment[] = [];

  for (const block of doc.blocks) {
    if (block.kind === 'heading') {
      const level = block.level ?? 1;
      while (stack.length > 0 && stack[stack.length - 1]!.level >= level) {
        stack.pop();
      }
      stack.push({ level, text: block.text });
      continue;
    }

    segments.push({
      text: block.text,
      startOffset: block.startOffset,
      endOffset: block.endOffset,
      type: segmentType(block),
      headingPath: stack.map((item) => item.text),
      ...(block.pageNumber === undefined ? {} : { pageNumber: block.pageNumber }),
      ...(block.rects ? { rects: block.rects } : {}),
      ...(block.language ? { language: block.language } : {}),
    });
  }

  return segments;
}

function splitSentences(text: string, baseOffset: number): Sentence[] {
  const parts = text.split(/(?<=[。！？；!?;\n])/);
  const sentences: Sentence[] = [];
  let cursor = baseOffset;

  for (const part of parts) {
    const lead = part.length - part.trimStart().length;
    const trimmed = part.trim();
    if (trimmed.length > 0) {
      sentences.push({
        text: trimmed,
        startOffset: cursor + lead,
        endOffset: cursor + lead + trimmed.length,
      });
    }
    cursor += part.length;
  }

  return sentences;
}

function splitLongSentence(sentence: Sentence, maxTokens: number): Sentence[] {
  const pieces: Sentence[] = [];
  let start = 0;

  while (start < sentence.text.length) {
    let low = 1;
    let high = sentence.text.length - start;
    let best = 1;

    while (low <= high) {
      const middle = (low + high) >> 1;
      const tokens = countTokens(sentence.text.slice(start, start + middle));
      if (tokens <= maxTokens) {
        best = middle;
        low = middle + 1;
      } else {
        high = middle - 1;
      }
    }

    pieces.push({
      text: sentence.text.slice(start, start + best),
      startOffset: sentence.startOffset + start,
      endOffset: sentence.startOffset + start + best,
    });
    start += best;
  }

  return pieces;
}

function headingKey(headingPath: string[]): string {
  return headingPath.join('\u0000');
}

function makeChunk(segments: Segment[]): CoreChunk {
  const first = segments[0]!;
  const last = segments[segments.length - 1]!;
  const rects = segments.flatMap((segment) => segment.rects ?? []).slice(0, MAX_RECTS);
  const pageNumbers = segments
    .map((segment) => segment.pageNumber)
    .filter((value): value is number => value !== undefined);

  return {
    startOffset: first.startOffset,
    endOffset: last.endOffset,
    type: first.type,
    headingPath: first.headingPath,
    ...(pageNumbers.length > 0
      ? { pageStart: Math.min(...pageNumbers), pageEnd: Math.max(...pageNumbers) }
      : {}),
    ...(rects.length > 0 ? { rects } : {}),
    ...(first.language ? { language: first.language } : {}),
  };
}

function splitStructured(segment: Segment, options: ChunkOptions): CoreChunk[] {
  if (countTokens(segment.text) <= options.hardMax) {
    return [makeChunk([segment])];
  }

  const lines = segment.text.split('\n');
  const header = segment.type === 'table' ? lines[0] : undefined;
  const body = header === undefined ? lines : lines.slice(1);
  const bodyBase = header === undefined ? 0 : 1;

  let cursor = segment.startOffset;
  const lineOffsets: number[] = [];
  for (const line of lines) {
    lineOffsets.push(cursor);
    cursor += line.length + 1;
  }

  const chunks: CoreChunk[] = [];
  let groupStart = 0;
  let groupTokens = header ? countTokens(header) : 0;

  const flush = (endIndex: number) => {
    if (endIndex <= groupStart) {
      return;
    }
    const firstLine = bodyBase + groupStart;
    const lastLine = bodyBase + endIndex - 1;
    const startOffset = lineOffsets[firstLine] ?? segment.startOffset;
    const endOffset = (lineOffsets[lastLine] ?? segment.endOffset) + (lines[lastLine]?.length ?? 0);

    chunks.push({
      startOffset,
      endOffset,
      type: segment.type,
      headingPath: segment.headingPath,
      ...(segment.pageNumber === undefined
        ? {}
        : { pageStart: segment.pageNumber, pageEnd: segment.pageNumber }),
      ...(segment.rects ? { rects: segment.rects.slice(0, MAX_RECTS) } : {}),
      ...(segment.language ? { language: segment.language } : {}),
      ...(header === undefined ? {} : { headerPrefix: header }),
    });
  };

  for (let index = 0; index < body.length; index += 1) {
    const tokens = countTokens(body[index]!);
    if (groupTokens + tokens > options.targetMax && index > groupStart) {
      flush(index);
      groupStart = index;
      groupTokens = header ? countTokens(header) : 0;
    }
    groupTokens += tokens;
  }
  flush(body.length);

  return chunks;
}

function buildGroup(segments: Segment[], options: ChunkOptions): CoreChunk[] {
  const chunks: CoreChunk[] = [];
  let accumulated: Segment[] = [];
  let accumulatedTokens = 0;

  const flushText = () => {
    if (accumulated.length > 0) {
      chunks.push(makeChunk(accumulated));
      accumulated = [];
      accumulatedTokens = 0;
    }
  };

  for (const segment of segments) {
    if (segment.type === 'code' || segment.type === 'table') {
      flushText();
      chunks.push(...splitStructured(segment, options));
      continue;
    }

    for (const sentence of splitSentences(segment.text, segment.startOffset)) {
      const tokens = countTokens(sentence.text);
      if (accumulatedTokens + tokens > options.targetMax && accumulated.length > 0) {
        flushText();
      }

      const sentences =
        tokens > options.hardMax ? splitLongSentence(sentence, options.targetMax) : [sentence];
      for (const piece of sentences) {
        accumulated.push({
          ...segment,
          text: piece.text,
          startOffset: piece.startOffset,
          endOffset: piece.endOffset,
        });
        accumulatedTokens += countTokens(piece.text);
      }
    }
  }

  flushText();
  return chunks;
}

function mergeSmallChunks(
  chunks: CoreChunk[],
  doc: ParsedDocument,
  options: ChunkOptions,
): CoreChunk[] {
  const merged: CoreChunk[] = [];

  for (const chunk of chunks) {
    const previous = merged[merged.length - 1];
    if (
      previous &&
      previous.type === chunk.type &&
      headingKey(previous.headingPath) === headingKey(chunk.headingPath) &&
      chunk.type !== 'code' &&
      chunk.type !== 'table'
    ) {
      const previousTokens = countTokens(doc.text.slice(previous.startOffset, previous.endOffset));
      const currentTokens = countTokens(doc.text.slice(chunk.startOffset, chunk.endOffset));
      const combined = countTokens(doc.text.slice(previous.startOffset, chunk.endOffset));

      if (
        (previousTokens < options.targetMin || currentTokens < options.targetMin) &&
        combined <= options.targetMax
      ) {
        merged[merged.length - 1] = {
          ...previous,
          endOffset: chunk.endOffset,
          ...(chunk.pageEnd === undefined ? {} : { pageEnd: chunk.pageEnd }),
          ...(previous.rects || chunk.rects
            ? { rects: [...(previous.rects ?? []), ...(chunk.rects ?? [])].slice(0, MAX_RECTS) }
            : {}),
        };
        continue;
      }
    }

    merged.push(chunk);
  }

  return merged;
}

function tailByTokens(text: string, budget: number): string {
  if (budget <= 0) {
    return '';
  }

  const sentences = splitSentences(text, 0);
  const picked: string[] = [];
  let total = 0;

  for (let index = sentences.length - 1; index >= 0; index -= 1) {
    const tokens = countTokens(sentences[index]!.text);
    if (total + tokens > budget && picked.length > 0) {
      break;
    }
    picked.unshift(sentences[index]!.text);
    total += tokens;
  }

  return picked.join(' ');
}

export function chunkDocument(
  doc: ParsedDocument,
  options: Partial<ChunkOptions> = {},
): ChunkDraft[] {
  const resolved: ChunkOptions = { ...DEFAULT_OPTIONS, ...options };
  const segments = toSegments(doc);
  if (segments.length === 0) {
    return [];
  }

  const groups: Array<{ key: string; segments: Segment[] }> = [];
  for (const segment of segments) {
    const key = headingKey(segment.headingPath);
    const last = groups[groups.length - 1];
    if (last && last.key === key) {
      last.segments.push(segment);
    } else {
      groups.push({ key, segments: [segment] });
    }
  }

  const cores = mergeSmallChunks(
    groups.flatMap((group) => buildGroup(group.segments, resolved)),
    doc,
    resolved,
  );
  const overlapBudget = Math.floor(resolved.targetMax * resolved.overlapRatio);

  return cores.map((chunk, index) => {
    const core = doc.text.slice(chunk.startOffset, chunk.endOffset);
    const previous = cores[index - 1];
    const overlapPrefix =
      previous &&
      chunk.type === 'text' &&
      headingKey(previous.headingPath) === headingKey(chunk.headingPath)
        ? tailByTokens(doc.text.slice(previous.startOffset, previous.endOffset), overlapBudget)
        : '';
    const prefix = chunk.headerPrefix ?? overlapPrefix;
    const text = prefix.length > 0 ? `${prefix}\n${core}` : core;
    const location =
      chunk.rects || chunk.language
        ? {
            ...(chunk.rects ? { rects: chunk.rects } : {}),
            ...(chunk.language ? { language: chunk.language } : {}),
          }
        : undefined;

    return {
      index,
      text,
      tokenCount: countTokens(text),
      startOffset: chunk.startOffset,
      endOffset: chunk.endOffset,
      ...(chunk.pageStart === undefined ? {} : { pageStart: chunk.pageStart }),
      ...(chunk.pageEnd === undefined ? {} : { pageEnd: chunk.pageEnd }),
      headingPath: chunk.headingPath,
      type: chunk.type,
      ...(location ? { location } : {}),
      searchText: buildSearchText(text),
    };
  });
}
