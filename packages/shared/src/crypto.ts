import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';

const VERSION = 'v1';

function deriveKey(secret: string): Buffer {
  const asBase64 = Buffer.from(secret, 'base64');
  if (asBase64.length === 32) {
    return asBase64;
  }

  const asHex = Buffer.from(secret, 'hex');
  if (asHex.length === 32) {
    return asHex;
  }

  return scryptSync(secret, 'knowledgeos-provider-key', 32);
}

export function encryptSecret(plaintext: string, secret: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', deriveKey(secret), iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return [
    VERSION,
    iv.toString('base64'),
    tag.toString('base64'),
    encrypted.toString('base64'),
  ].join(':');
}

export function decryptSecret(payload: string, secret: string): string {
  const [version, iv, tag, data] = payload.split(':');
  if (version !== VERSION || !iv || !tag || !data) {
    throw new Error('invalid secret payload');
  }

  const decipher = createDecipheriv('aes-256-gcm', deriveKey(secret), Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));

  return Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString(
    'utf8',
  );
}
