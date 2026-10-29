import { describe, expect, it } from 'vitest'
import {
  publicInteractivePayload,
  stripInternalPayloadKeys,
} from './internal-payload'

describe('internal payload helpers', () => {
  it('treats a provenance-only payload as null', () => {
    expect(publicInteractivePayload({ _wacrm_phone_number_id: '123' })).toBeNull()
    expect(publicInteractivePayload({})).toBeNull()
    expect(publicInteractivePayload(null)).toBeNull()
  })

  it('strips _wacrm_ keys and keeps the public payload', () => {
    const payload = {
      type: 'button',
      body: 'Hi',
      _wacrm_phone_number_id: '123',
    }
    expect(stripInternalPayloadKeys(payload)).toEqual({
      type: 'button',
      body: 'Hi',
    })
    expect(publicInteractivePayload(payload)).toEqual({
      type: 'button',
      body: 'Hi',
    })
  })
})
