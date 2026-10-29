import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

function key(): Buffer {
  const raw = process.env.WACRM_TOKEN_ENC_KEY;
  if (!raw || !/^[A-Za-z0-9+/]{43}=$/.test(raw)) throw new Error('Invalid token encryption key');
  const bytes = Buffer.from(raw, 'base64');
  if (bytes.length !== 32 || bytes.toString('base64') !== raw) throw new Error('Invalid token encryption key');
  return bytes;
}

/** base64(iv[12] | authTag[16] | ciphertext); authenticated AES-256-GCM. */
export function encryptToken(value: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString('base64');
}

export function decryptToken(encoded: string): string {
  const raw = Buffer.from(encoded, 'base64');
  if (raw.length < 29 || raw.toString('base64') !== encoded) throw new Error('Invalid ciphertext');
  const decipher = createDecipheriv('aes-256-gcm', key(), raw.subarray(0, 12));
  decipher.setAuthTag(raw.subarray(12, 28));
  return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString('utf8');
}
