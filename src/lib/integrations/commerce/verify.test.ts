import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import {
  verifySharedSecret,
  verifyShopifyHmac,
  verifyWooSignature,
} from './verify';

describe('commerce webhook verification', () => {
  const body = '{"id":1,"phone":"9876543210"}';
  const secret = 'whsec_test_secret';

  it('accepts a valid Shopify HMAC', () => {
    const digest = createHmac('sha256', secret).update(body, 'utf8').digest('base64');
    expect(verifyShopifyHmac(body, secret, digest)).toBe(true);
    expect(verifyShopifyHmac(body, secret, 'nope')).toBe(false);
  });

  it('accepts Woo signature (same shape) and shared secret', () => {
    const digest = createHmac('sha256', secret).update(body, 'utf8').digest('base64');
    expect(verifyWooSignature(body, secret, digest)).toBe(true);
    expect(verifySharedSecret(secret, secret)).toBe(true);
    expect(verifySharedSecret('x', secret)).toBe(false);
  });
});
