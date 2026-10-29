/**
 * Ensures every WhatsApp send / inbound path that should meter usage
 * imports recordWhatsappUsage.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const PATHS = [
  'src/lib/whatsapp/send-message.ts',
  'src/lib/whatsapp/broadcast-core.ts',
  'src/app/api/whatsapp/broadcast/route.ts',
  'src/lib/automations/meta-send.ts',
  'src/lib/flows/meta-send.ts',
  'src/app/api/whatsapp/webhook/route.ts',
] as const

describe('WhatsApp usage metering wiring', () => {
  for (const rel of PATHS) {
    it(`${rel} calls recordWhatsappUsage`, () => {
      const src = readFileSync(join(process.cwd(), rel), 'utf8')
      expect(src).toMatch(/recordWhatsappUsage/)
    })
  }
})
