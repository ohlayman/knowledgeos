import { PDFDocument, StandardFonts } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { ApiError } from '@kos/shared';
import { mapPdfError, parsePdf } from './pdf.js';

async function makePdf(pageCount: number): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);

  for (let index = 1; index <= pageCount; index += 1) {
    const page = doc.addPage([595, 842]);
    page.drawText('KnowledgeOS internal header', { x: 50, y: 800, size: 9, font });
    page.drawText(`Page ${index} heading`, { x: 50, y: 740, size: 16, font });
    page.drawText(`First paragraph on page ${index}.`, { x: 50, y: 700, size: 12, font });
    page.drawText(`Second paragraph on page ${index}.`, { x: 50, y: 600, size: 12, font });
    page.drawText(`${index}`, { x: 300, y: 30, size: 9, font });
  }

  return Buffer.from(await doc.save());
}

async function makeBlankPdf(pageCount: number): Promise<Buffer> {
  const doc = await PDFDocument.create();
  for (let index = 0; index < pageCount; index += 1) {
    doc.addPage([595, 842]);
  }
  return Buffer.from(await doc.save());
}

describe('parsePdf', () => {
  it('20 页文档产出页码与块定位', async () => {
    const doc = await parsePdf(await makePdf(20));

    expect(doc.pages).toHaveLength(20);
    expect(doc.pages[0]?.pageNumber).toBe(1);
    expect(doc.pages[19]?.pageNumber).toBe(20);
    expect(doc.blocks.length).toBeGreaterThanOrEqual(60);

    for (const block of doc.blocks) {
      expect(block.pageNumber).toBeGreaterThanOrEqual(1);
      expect(block.pageNumber).toBeLessThanOrEqual(20);
      expect(doc.text.slice(block.startOffset, block.endOffset)).toBe(block.text);
    }
  });

  it('抽取 5 个块做定位抽查', async () => {
    const doc = await parsePdf(await makePdf(20));

    for (const pageNumber of [1, 5, 10, 15, 20]) {
      const block = doc.blocks.find(
        (item) => item.pageNumber === pageNumber && item.text.includes('Page'),
      );
      expect(block, `缺少第 ${pageNumber} 页文本块`).toBeDefined();
      expect(block!.text).toContain(`Page ${pageNumber}`);
      expect(block!.rects?.length).toBeGreaterThan(0);
      expect(block!.rects![0]!.width).toBeGreaterThan(0);
    }
  });

  it('剔除逐页重复的页眉页脚', async () => {
    const doc = await parsePdf(await makePdf(20));

    expect(doc.text).not.toContain('KnowledgeOS internal header');
  });

  it('无文本页面标记 needs_ocr', async () => {
    const doc = await parsePdf(await makeBlankPdf(3));

    expect(doc.warnings).toContain('needs_ocr');
    expect(doc.blocks).toEqual([]);
  });

  it('密码错误映射为 PDF_PASSWORD_REQUIRED', () => {
    const error = mapPdfError(
      Object.assign(new Error('no password'), { name: 'PasswordException' }),
    );

    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).code).toBe('PDF_PASSWORD_REQUIRED');
    expect((error as ApiError).retryable).toBe(false);
  });
});
