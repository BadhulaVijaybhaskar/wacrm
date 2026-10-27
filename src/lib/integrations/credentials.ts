/**
 * Encrypt / decrypt per-integration credential bags.
 * Plaintext never leaves the server after connect.
 */

import { decrypt, encrypt } from '@/lib/whatsapp/encryption';

export type CredentialBag = Record<string, string>;

export function encryptCredentials(bag: CredentialBag): string {
  const cleaned: CredentialBag = {};
  for (const [k, v] of Object.entries(bag)) {
    if (typeof v !== 'string') continue;
    const trimmed = v.trim();
    if (trimmed) cleaned[k] = trimmed;
  }
  return encrypt(JSON.stringify(cleaned));
}

export function decryptCredentials(
  cipher: string | null | undefined,
): CredentialBag {
  if (!cipher) return {};
  try {
    const plain = decrypt(cipher);
    const parsed = JSON.parse(plain) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {};
    }
    const out: CredentialBag = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v === 'string' && v.trim()) out[k] = v.trim();
    }
    return out;
  } catch (err) {
    console.error(
      '[integrations] credential decrypt failed:',
      err instanceof Error ? err.message : err,
    );
    return {};
  }
}

/** Public view of which credential keys are present (never values). */
export function credentialPresence(bag: CredentialBag): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const [k, v] of Object.entries(bag)) {
    out[k] = Boolean(v);
  }
  return out;
}
