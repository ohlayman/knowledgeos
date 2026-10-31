import { describe, expect, it } from 'vitest';
import { contentHash, fileHash, normalizeText, sha256Hex } from './hash.js';

describe('normalizeText', () => {
  it('normalizes CRLF and CR to LF', () => {
    expect(normalizeText('a\r\nb\rc')).toBe('a\nb\nc');
  });

  it('removes trailing spaces and collapses blank lines', () => {
    expect(normalizeText('a   \n\n\n\nb\t')).toBe('a\n\nb');
  });

  it('removes control characters but keeps tabs and indentation', () => {
    expect(normalizeText('\u0000  indented\tcode\u0007')).toBe('  indented\tcode');
  });
});

describe('contentHash', () => {
  it('hashes normalized content', () => {
    expect(contentHash('a\r\nb')).toBe(contentHash('a\nb'));
  });

  it('produces different hashes for different content', () => {
    expect(contentHash('alpha')).not.toBe(contentHash('beta'));
  });
});

describe('fileHash', () => {
  it('matches the known sha256 of "hello"', () => {
    expect(fileHash(Buffer.from('hello'))).toBe(
      '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824',
    );
  });

  it('hashes strings and buffers identically', () => {
    expect(sha256Hex('hello')).toBe(fileHash(Buffer.from('hello')));
  });
});
