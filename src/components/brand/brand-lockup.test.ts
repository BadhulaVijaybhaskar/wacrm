import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { createElement } from 'react'
import {
  BrandLockup,
  BRAND_LOCKUP_DARK,
  BRAND_LOCKUP_LIGHT,
} from './brand-lockup'

describe('BrandLockup', () => {
  it('exposes the dark lockup asset path', () => {
    expect(BRAND_LOCKUP_DARK[275]).toBe('/brand/astra-chat-lockup-dark-275.png')
    expect(BRAND_LOCKUP_DARK.full).toBe('/brand/astra-chat-lockup-dark.png')
    expect(BRAND_LOCKUP_LIGHT[275]).toContain('astra-chat-lockup-275.png')
  })

  it('dark mode markup always includes astra-chat-lockup-dark.png (CSS swap)', () => {
    const html = renderToStaticMarkup(
      createElement(BrandLockup, { size: 'full', width: 320, height: 76 }),
    )
    expect(html).toContain('astra-chat-lockup-dark.png')
    expect(html).toContain('data-brand-lockup="dark"')
    expect(html).toContain('data-brand-lockup="light"')
    expect(html).toContain('brand-lockup-dark')
  })

  it('forceDark renders only the dark asset', () => {
    const html = renderToStaticMarkup(
      createElement(BrandLockup, { forceDark: true, size: 275 }),
    )
    expect(html).toContain('astra-chat-lockup-dark-275.png')
    expect(html).not.toContain('data-brand-lockup="light"')
  })
})
