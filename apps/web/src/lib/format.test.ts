import { describe, expect, it } from 'vitest';
import { formatBytes, formatRelative, statusLabel, statusTone } from './format.js';

describe('formatBytes', () => {
  it('按单位换算', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(1024)).toBe('1.0 KB');
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 MB');
  });
});

describe('formatRelative', () => {
  it('区分分钟、小时与天', () => {
    const now = Date.now();
    expect(formatRelative(new Date(now - 30_000))).toBe('刚刚');
    expect(formatRelative(new Date(now - 5 * 60_000))).toBe('5 分钟前');
    expect(formatRelative(new Date(now - 3 * 3600_000))).toBe('3 小时前');
    expect(formatRelative(new Date(now - 2 * 86400_000))).toBe('2 天前');
  });
});

describe('statusLabel', () => {
  it('映射中文标签', () => {
    expect(statusLabel('ready')).toBe('就绪');
    expect(statusLabel('needs_ocr')).toBe('需要 OCR');
    expect(statusLabel('unknown')).toBe('unknown');
  });
});

describe('statusTone', () => {
  it('按状态给出语义色', () => {
    expect(statusTone('ready')).toBe('ok');
    expect(statusTone('failed')).toBe('bad');
    expect(statusTone('queued')).toBe('warn');
    expect(statusTone('whatever')).toBe('');
  });
});
