/**
 * Short-lived signed HTTPS URLs for inbound WhatsApp media that Astra
 * Connect fetches without auth (contract §6: ~15 min, https only).
 *
 * Token = base64url(payloadJson) + '.' + base64url(hmac-sha256)
 * Served by GET /api/astra-connect/media/[token].
 */

import { createHmac, timingSafeEqual } from 'node:crypto'
import { adapterSecret, publicSiteOrigin } from './config'
import type { AstraMediaRef, AstraMediaType } from './types'

export const MEDIA_URL_TTL_SECONDS = 15 * 60 // ~15 minutes

export interface SignedMediaPayload {
  /** Account that owns the media (tenancy for Meta token / storage). */
  a: string
  /** Meta media id (used when we must re-fetch from Meta). */
  m: string
  /** Durable chat-media public URL or storage path, when mirrored. */
  u?: string
  /** MIME type hint. */
  t?: string
  /** Expiry as unix seconds. */
  e: number
}

function b64url(input: Buffer | string): string {
  const buf = typeof input === 'string' ? Buffer.from(input, 'utf8') : input
  return buf
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

function fromB64url(value: string): Buffer {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/')
  const pad = padded.length % 4 === 0 ? '' : '='.repeat(4 - (padded.length % 4))
  return Buffer.from(padded + pad, 'base64')
}

function mediaSigningSecret(): string | null {
  // Prefer the adapter secret; fall back to ENCRYPTION_KEY so media
  // signing still works in local tests that only set the latter.
  return adapterSecret() ?? process.env.ENCRYPTION_KEY?.trim() ?? null
}

export function signMediaPayload(
  payload: SignedMediaPayload,
  secret: string
): string {
  const body = b64url(JSON.stringify(payload))
  const sig = b64url(
    createHmac('sha256', secret).update(body).digest()
  )
  return `${body}.${sig}`
}

export function verifyMediaToken(
  token: string,
  secret: string,
  nowSeconds: number = Math.floor(Date.now() / 1000)
): SignedMediaPayload | null {
  const parts = token.split('.')
  if (parts.length !== 2) return null
  const [body, sig] = parts
  if (!body || !sig) return null

  const expected = b64url(
    createHmac('sha256', secret).update(body).digest()
  )
  const a = Buffer.from(expected)
  const b = Buffer.from(sig)
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null

  let payload: SignedMediaPayload
  try {
    payload = JSON.parse(fromB64url(body).toString('utf8')) as SignedMediaPayload
  } catch {
    return null
  }
  if (!payload?.a || !payload?.m || !Number.isFinite(payload.e)) return null
  if (payload.e < nowSeconds) return null
  return payload
}

export interface SignedMediaUrlResult {
  url: string
  /** ISO-8601 expiry of the signed token. */
  expires_at: string
  expires_at_unix: number
}

/**
 * Build a Connect-fetchable media URL on this deployment's public host.
 * Returns null when the site origin or signing secret is missing.
 */
export function buildSignedMediaUrl(args: {
  accountId: string
  mediaId: string
  durableUrl?: string | null
  mimeType?: string | null
  ttlSeconds?: number
  nowSeconds?: number
  origin?: string | null
  secret?: string | null
}): string | null {
  return buildSignedMediaUrlWithExpiry(args)?.url ?? null
}

/** Same as `buildSignedMediaUrl` but also returns the token expiry. */
export function buildSignedMediaUrlWithExpiry(args: {
  accountId: string
  mediaId: string
  durableUrl?: string | null
  mimeType?: string | null
  ttlSeconds?: number
  nowSeconds?: number
  origin?: string | null
  secret?: string | null
}): SignedMediaUrlResult | null {
  // Explicit `null` means "no value" (do not fall back to env). Omit the
  // field (or pass `undefined`) to use the configured site origin / secret.
  const secret =
    args.secret !== undefined ? args.secret : mediaSigningSecret()
  const origin = (
    args.origin !== undefined ? args.origin : publicSiteOrigin()
  )?.replace(/\/+$/, '')
  if (!secret || !origin) return null

  const now = args.nowSeconds ?? Math.floor(Date.now() / 1000)
  const ttl = args.ttlSeconds ?? MEDIA_URL_TTL_SECONDS
  const expiresAtUnix = now + ttl
  const payload: SignedMediaPayload = {
    a: args.accountId,
    m: args.mediaId,
    e: expiresAtUnix,
  }
  if (args.durableUrl) payload.u = args.durableUrl
  if (args.mimeType) payload.t = args.mimeType

  const token = signMediaPayload(payload, secret)
  return {
    url: `${origin}/api/astra-connect/media/${encodeURIComponent(token)}`,
    expires_at: new Date(expiresAtUnix * 1000).toISOString(),
    expires_at_unix: expiresAtUnix,
  }
}

/** Map Meta inbound message type → Connect media type. */
export function astraMediaTypeFor(
  messageType: string
): AstraMediaType | null {
  switch (messageType) {
    case 'image':
    case 'audio':
    case 'video':
    case 'document':
    case 'sticker':
    case 'location':
    case 'contacts':
      return messageType
    default:
      return null
  }
}

/**
 * Build the `media[]` array for an inbound Connect payload from a
 * parsed Meta message + optional durable/mirrored URL.
 */
export function buildInboundMediaRefs(args: {
  accountId: string
  messageType: string
  mediaId?: string | null
  durableUrl?: string | null
  mimeType?: string | null
  caption?: string | null
  filename?: string | null
  origin?: string | null
  secret?: string | null
  nowSeconds?: number
}): AstraMediaRef[] {
  const type = astraMediaTypeFor(args.messageType)
  if (!type || type === 'location' || type === 'contacts') {
    // Location/contacts have no downloadable bytes; Connect still
    // accepts them as typed refs without a url — only include when we
    // have an id-like handle. Skip for now (text carries the location).
    return []
  }
  if (!args.mediaId) return []

  const url = buildSignedMediaUrl({
    accountId: args.accountId,
    mediaId: args.mediaId,
    durableUrl: args.durableUrl,
    mimeType: args.mimeType,
    origin: args.origin,
    secret: args.secret,
    nowSeconds: args.nowSeconds,
  })
  if (!url) return []

  const ref: AstraMediaRef = {
    type,
    id: args.mediaId,
    url,
  }
  if (args.mimeType) ref.mime_type = args.mimeType
  if (args.caption) ref.caption = args.caption
  if (args.filename) ref.filename = args.filename
  return [ref]
}

export { mediaSigningSecret }
