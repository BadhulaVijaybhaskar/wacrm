import { describe, it, expect } from 'vitest'
import {
  buildSignedMediaUrl,
  buildInboundMediaRefs,
  verifyMediaToken,
  signMediaPayload,
  MEDIA_URL_TTL_SECONDS,
} from './media'

const SECRET = 'test-adapter-secret-16+'

describe('signed media URLs', () => {
  it('builds an https URL valid for ~15 minutes', () => {
    const now = 1_700_000_000
    const url = buildSignedMediaUrl({
      accountId: 'acct-1',
      mediaId: 'media_123',
      durableUrl: 'https://storage.example/chat-media/x',
      mimeType: 'audio/ogg',
      nowSeconds: now,
      origin: 'https://wa.astraconnect.io',
      secret: SECRET,
    })

    expect(url).toMatch(
      /^https:\/\/wa\.astraconnect\.io\/api\/astra-connect\/media\//
    )

    const token = decodeURIComponent(url!.split('/').pop()!)
    const payload = verifyMediaToken(token, SECRET, now + 60)
    expect(payload).toMatchObject({
      a: 'acct-1',
      m: 'media_123',
      t: 'audio/ogg',
      e: now + MEDIA_URL_TTL_SECONDS,
    })
    expect(payload!.e - now).toBe(15 * 60)
  })

  it('rejects an expired token', () => {
    const now = 1_700_000_000
    const token = signMediaPayload(
      { a: 'acct-1', m: 'media_123', e: now - 1 },
      SECRET
    )
    expect(verifyMediaToken(token, SECRET, now)).toBeNull()
  })

  it('rejects a tampered token', () => {
    const token = signMediaPayload(
      { a: 'acct-1', m: 'media_123', e: 9_999_999_999 },
      SECRET
    )
    expect(verifyMediaToken(token + 'x', SECRET)).toBeNull()
  })

  it('buildInboundMediaRefs returns a Connect media[] item', () => {
    const refs = buildInboundMediaRefs({
      accountId: 'acct-1',
      messageType: 'audio',
      mediaId: 'media_123',
      mimeType: 'audio/ogg',
      origin: 'https://wa.astraconnect.io',
      secret: SECRET,
      nowSeconds: 1_700_000_000,
    })
    expect(refs).toHaveLength(1)
    expect(refs[0]).toMatchObject({
      type: 'audio',
      id: 'media_123',
      mime_type: 'audio/ogg',
    })
    expect(refs[0].url).toContain('/api/astra-connect/media/')
  })

  it('returns no refs when origin/secret missing', () => {
    const refs = buildInboundMediaRefs({
      accountId: 'acct-1',
      messageType: 'image',
      mediaId: 'm1',
      origin: null,
      secret: null,
    })
    expect(refs).toEqual([])
  })
})
