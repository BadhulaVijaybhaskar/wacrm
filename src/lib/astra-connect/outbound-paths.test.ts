/**
 * Ensures every non-Connect outbound path imports notifyConnectOutbound
 * so Connect's /message stays in sync when the adapter is on.
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
] as const

describe('outbound Connect notify wiring', () => {
  for (const rel of PATHS) {
    it(`${rel} calls notifyConnectOutbound`, () => {
      const src = readFileSync(join(process.cwd(), rel), 'utf8')
      expect(src).toMatch(/notifyConnectOutbound/)
    })
  }
})
