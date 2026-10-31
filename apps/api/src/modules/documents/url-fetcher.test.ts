import { describe, expect, it } from 'vitest';
import { fetchUrl, isPublicAddress } from './url-fetcher.js';

describe('isPublicAddress', () => {
  it('rejects private, loopback, link-local and unique-local addresses', () => {
    for (const address of [
      '127.0.0.1',
      '10.0.0.1',
      '172.16.0.1',
      '192.168.1.1',
      '169.254.1.1',
      '::1',
      'fc00::1',
      'fe80::1',
    ]) {
      expect(isPublicAddress(address), address).toBe(false);
    }
  });

  it('allows public addresses', () => {
    expect(isPublicAddress('8.8.8.8')).toBe(true);
    expect(isPublicAddress('2606:4700:4700::1111')).toBe(true);
  });
});

describe('fetchUrl', () => {
  it('rejects non-http protocols', async () => {
    await expect(fetchUrl('file:///etc/passwd')).rejects.toMatchObject({
      code: 'SSRF_BLOCKED',
    });
  });

  it('rejects URLs containing credentials', async () => {
    await expect(fetchUrl('http://user:pass@example.com')).rejects.toMatchObject({
      code: 'SSRF_BLOCKED',
    });
  });

  it('rejects loopback and private IP literals before connecting', async () => {
    await expect(fetchUrl('http://127.0.0.1:1')).rejects.toMatchObject({
      code: 'SSRF_BLOCKED',
    });
    await expect(fetchUrl('http://192.168.1.1')).rejects.toMatchObject({
      code: 'SSRF_BLOCKED',
    });
  });
});
