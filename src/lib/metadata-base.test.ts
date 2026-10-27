import { afterEach, describe, expect, it } from 'vitest'

import {
  OG_IMAGE_PATH,
  absolutizeMetadataUrl,
  resolveMetadataBase,
  resolveOgImageUrl,
} from '@/lib/metadata-base'

describe('resolveMetadataBase', () => {
  afterEach(() => {
    // no shared mutation — tests pass env explicitly
  })

  it('uses NEXT_PUBLIC_SITE_URL when set', () => {
    const base = resolveMetadataBase({
      env: { NEXT_PUBLIC_SITE_URL: 'https://wa.astraconnect.io/' },
      nodeEnv: 'production',
    })
    expect(base.toString()).toBe('https://wa.astraconnect.io/')
  })

  it('in development, falls back to the request host when SITE_URL is unset', () => {
    const base = resolveMetadataBase({
      env: {},
      nodeEnv: 'development',
      headers: {
        get(name) {
          if (name === 'host') return '127.0.0.1:3101'
          if (name === 'x-forwarded-proto') return 'http'
          return null
        },
      },
    })
    expect(base.toString()).toBe('http://127.0.0.1:3101/')
  })

  it('in production, does not trust the request host when SITE_URL is unset', () => {
    const base = resolveMetadataBase({
      env: {},
      nodeEnv: 'production',
      headers: {
        get(name) {
          if (name === 'host') return 'evil.example'
          return null
        },
      },
    })
    expect(base.toString()).toBe('http://localhost:3000/')
  })
})

describe('built HTML og:image', () => {
  it('is absolute and uses the site URL (not localhost)', () => {
    const site = 'https://wa.astraconnect.io'
    const ogImage = resolveOgImageUrl({
      env: { NEXT_PUBLIC_SITE_URL: site },
      nodeEnv: 'production',
    })

    // What Next emits for <meta property="og:image" content="…">
    // after composing metadataBase + openGraph.images[0].url.
    const composed = absolutizeMetadataUrl(
      resolveMetadataBase({
        env: { NEXT_PUBLIC_SITE_URL: site },
        nodeEnv: 'production',
      }),
      OG_IMAGE_PATH,
    )

    expect(ogImage).toBe(composed)
    expect(ogImage).toBe('https://wa.astraconnect.io/brand/og.png')
    expect(ogImage.startsWith('https://')).toBe(true)
    expect(ogImage).not.toMatch(/localhost|127\.0\.0\.1/)
    expect(() => new URL(ogImage)).not.toThrow()
  })
})
