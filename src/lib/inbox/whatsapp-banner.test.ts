import { describe, expect, it } from 'vitest'
import {
  clearWhatsappBannerDismissed,
  readWhatsappBannerDismissed,
  WHATSAPP_SETUP_HREF,
  whatsappBannerDismissStorageKey,
  writeWhatsappBannerDismissed,
} from './whatsapp-banner'

function memoryStorage(): Storage {
  const map = new Map<string, string>()
  return {
    get length() {
      return map.size
    },
    clear() {
      map.clear()
    },
    getItem(key: string) {
      return map.has(key) ? map.get(key)! : null
    },
    key() {
      return null
    },
    removeItem(key: string) {
      map.delete(key)
    },
    setItem(key: string, value: string) {
      map.set(key, value)
    },
  }
}

describe('WhatsApp banner dismiss + CTA', () => {
  it('Connect WhatsApp goes to the WhatsApp setup settings tab', () => {
    expect(WHATSAPP_SETUP_HREF).toBe('/settings?tab=whatsapp')
  })

  it('dismissal persists per user and does not leak across users', () => {
    const storage = memoryStorage()
    const a = 'user-a'
    const b = 'user-b'

    expect(readWhatsappBannerDismissed(storage, a)).toBe(false)
    writeWhatsappBannerDismissed(storage, a)
    expect(readWhatsappBannerDismissed(storage, a)).toBe(true)
    expect(readWhatsappBannerDismissed(storage, b)).toBe(false)
    expect(whatsappBannerDismissStorageKey(a)).not.toBe(
      whatsappBannerDismissStorageKey(b),
    )

    clearWhatsappBannerDismissed(storage, a)
    expect(readWhatsappBannerDismissed(storage, a)).toBe(false)
  })
})
