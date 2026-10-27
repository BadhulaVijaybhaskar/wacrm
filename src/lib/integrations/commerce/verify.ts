import { createHmac, timingSafeEqual } from 'node:crypto';

/** Shopify webhook HMAC (base64 of sha256 over raw body). */
export function verifyShopifyHmac(
  rawBody: string,
  secret: string,
  headerValue: string | null | undefined,
): boolean {
  if (!headerValue || !secret) return false;
  const digest = createHmac('sha256', secret).update(rawBody, 'utf8').digest('base64');
  const a = Buffer.from(digest);
  const b = Buffer.from(headerValue.trim());
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** WooCommerce webhook secret: header `X-WC-Webhook-Signature` (base64 hmac-sha256). */
export function verifyWooSignature(
  rawBody: string,
  secret: string,
  headerValue: string | null | undefined,
): boolean {
  return verifyShopifyHmac(rawBody, secret, headerValue);
}

/** Optional shared-secret header check (Woo can also use query/topic). */
export function verifySharedSecret(
  provided: string | null | undefined,
  expected: string,
): boolean {
  if (!provided || !expected) return false;
  const a = Buffer.from(provided.trim());
  const b = Buffer.from(expected.trim());
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
