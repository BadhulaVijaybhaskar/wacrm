// ============================================================
// Astra Connect adapter request signing.
//
// Contract (v2):
//   X-Astra-Timestamp: <unix seconds>
//   X-Astra-Signature: sha256=<hex>
// where the signed message is `${timestamp}.${rawBody}` and the key is
// WACRM_ADAPTER_SECRET (global for now; per-account secret later).
//
// Reuses the same HMAC-SHA256 + constant-time compare pattern as
// `src/lib/webhooks/sign.ts` (Stripe-style wacrm→subscriber webhooks),
// but Connect's header names/shape differ, so this stays separate.
// ============================================================

import { createHmac, timingSafeEqual } from 'node:crypto'

/** Build the `X-Astra-Signature` header value (`sha256=<hex>`). */
export function buildAstraSignature(
  rawBody: string,
  secret: string,
  timestampSeconds: number
): string {
  const hex = createHmac('sha256', secret)
    .update(`${timestampSeconds}.`)
    .update(rawBody)
    .digest('hex')
  return `sha256=${hex}`
}

/**
 * Verify an Astra Connect signature header. Used by tests and any
 * future wacrm endpoint that must accept Connect callbacks.
 */
export function verifyAstraSignature(
  signatureHeader: string,
  rawBody: string,
  secret: string,
  timestampSeconds: number,
  nowSeconds: number,
  toleranceSeconds = 300
): boolean {
  if (!Number.isFinite(timestampSeconds)) return false
  if (Math.abs(nowSeconds - timestampSeconds) > toleranceSeconds) return false

  const presented = signatureHeader.trim().toLowerCase()
  if (!presented.startsWith('sha256=')) return false
  const hex = presented.slice('sha256='.length)
  if (!/^[0-9a-f]+$/.test(hex)) return false

  const expected = buildAstraSignature(rawBody, secret, timestampSeconds)
  const expectedHex = expected.slice('sha256='.length)
  if (expectedHex.length !== hex.length) return false
  return timingSafeEqual(Buffer.from(expectedHex), Buffer.from(hex))
}

/** Headers to attach to an outbound Connect adapter call. */
export function astraAuthHeaders(
  rawBody: string,
  secret: string,
  timestampSeconds: number = Math.floor(Date.now() / 1000)
): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'X-Astra-Timestamp': String(timestampSeconds),
    'X-Astra-Signature': buildAstraSignature(rawBody, secret, timestampSeconds),
  }
}
