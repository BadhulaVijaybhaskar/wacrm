import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  credentialPresence,
  decryptCredentials,
  encryptCredentials,
} from './credentials';

describe('integration credentials', () => {
  const prev = process.env.ENCRYPTION_KEY;

  beforeEach(() => {
    // 32-byte key as 64 hex chars
    process.env.ENCRYPTION_KEY = 'a'.repeat(64);
  });

  afterEach(() => {
    if (prev === undefined) delete process.env.ENCRYPTION_KEY;
    else process.env.ENCRYPTION_KEY = prev;
  });

  it('round-trips a credential bag', () => {
    const cipher = encryptCredentials({
      key_id: 'rzp_test',
      key_secret: 'super-secret',
      empty: '  ',
    });
    expect(cipher.split(':')).toHaveLength(3);
    const bag = decryptCredentials(cipher);
    expect(bag).toEqual({ key_id: 'rzp_test', key_secret: 'super-secret' });
    expect(credentialPresence(bag)).toEqual({
      key_id: true,
      key_secret: true,
    });
  });

  it('returns empty bag for missing/invalid cipher', () => {
    expect(decryptCredentials(null)).toEqual({});
    expect(decryptCredentials('not-valid')).toEqual({});
  });
});
