import { describe, expect, it } from 'vitest';
import { normalizeUrl } from './url.js';

describe('normalizeUrl', () => {
  it('lowercases the host and removes the fragment and default ports', () => {
    expect(normalizeUrl('HTTPS://Example.COM:443/path?q=1#frag')).toBe(
      'https://example.com/path?q=1',
    );
    expect(normalizeUrl('http://Example.com:80/')).toBe('http://example.com/');
  });

  it('preserves path and query', () => {
    expect(normalizeUrl('https://example.com/docs?x=1')).toBe('https://example.com/docs?x=1');
  });

  it('rejects non-http protocols', () => {
    expect(() => normalizeUrl('ftp://example.com')).toThrow(/http/);
  });
});
