import { describe, expect, it } from 'vitest';
import { decryptSecret, encryptSecret } from './crypto.js';

describe('encryptSecret', () => {
  it('可逆且每次密文不同', () => {
    const key = 'dev-secret-key';
    const first = encryptSecret('sk-test-123', key);
    const second = encryptSecret('sk-test-123', key);

    expect(first).not.toBe(second);
    expect(decryptSecret(first, key)).toBe('sk-test-123');
    expect(decryptSecret(second, key)).toBe('sk-test-123');
  });

  it('错误密钥无法解密', () => {
    const payload = encryptSecret('secret', 'key-a');

    expect(() => decryptSecret(payload, 'key-b')).toThrow();
  });

  it('篡改密文会被检测', () => {
    const payload = encryptSecret('secret', 'key');
    const parts = payload.split(':');
    const tampered = `${parts[0]}:${parts[1]}:${parts[2]}:${Buffer.from('evil').toString('base64')}`;

    expect(() => decryptSecret(tampered, 'key')).toThrow();
  });

  it('拒绝格式不合法的载荷', () => {
    expect(() => decryptSecret('not-a-payload', 'key')).toThrow(/payload/);
  });
});
